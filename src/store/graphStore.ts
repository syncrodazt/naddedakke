import { create } from 'zustand';
import { temporal } from 'zundo';
import type { Highlight, REdge, RNode, Session, SessionExport } from '../model/types';
import { newId } from '../model/ids';
import { recomputeGraph } from '../gyakusan/engine';
import { reanchorHighlights } from '../markdown/reanchor';
import { db } from '../db/db';
import { flushNow, initPersistence, markDirty } from '../db/persistence';
import { collectSubtree } from './subtree';
import { clearHistory, pauseHistory, resumeHistory } from './history';
import {
  answerPosition,
  branchDepth,
  branchPosition,
  computeLayout,
  spinePosition,
  whySiblingCount,
  type NodeMetrics,
} from '../layout/layout';

export type SelectionRange = { start: number; end: number; text: string };

type GraphState = {
  session: Session | null;
  nodes: Record<string, RNode>;
  edges: Record<string, REdge>;
  streamingNodeId: string | null; // answer node currently receiving a stream
  pendingQuestionId: string | null; // question node showing its compose box
  computeIssues: Record<string, string>; // gyakusan: nodeId → cycle/eval issue
  lessonComplete: boolean; // learn mode: model signaled the lesson is finished
  // Bumped once a session create/import has actually reached Dexie. Views that
  // list sessions must watch this, not session.id: the id changes on the render
  // before the flush, so refreshing on it alone reads the database too early
  // and misses the session that was just written.
  sessionsRevision: number;
};

type GraphActions = {
  createSession: (title: string) => Promise<string>;
  loadSession: (id: string) => Promise<boolean>;
  addChunk: (md: string) => string;
  addWhyBranch: (
    parentId: string,
    sel: SelectionRange,
    intent?: 'why' | 'respond' | 'idea',
  ) => string;
  addIdeaBranch: (parentId: string) => string;
  deleteNode: (nodeId: string) => void;
  submitQuestion: (questionId: string, questionText: string) => string;
  appendToNode: (nodeId: string, delta: string) => void;
  setNodeMd: (nodeId: string, md: string) => void;
  reanchorNodeHighlights: (nodeId: string) => void;
  setStreamingNode: (nodeId: string | null) => void;
  setLessonComplete: (complete: boolean) => void;
  finishStreaming: () => void;
  setNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  setNodeSize: (nodeId: string, size: { width: number; height: number }) => void;
  toggleUnderstood: (nodeId: string) => void;
  tidyLayout: (metrics?: NodeMetrics) => void;
  setPlaygroundParams: (nodeId: string, params: Record<string, number>) => void;
  setVariableValue: (nodeId: string, value: number) => void;
  recompute: () => void;
  setPendingQuestion: (questionId: string | null) => void;
  applyImport: (payload: SessionExport) => Promise<void>;
};

type GraphStore = GraphState & GraphActions;

/**
 * Only the graph itself is undoable. seqCounter is deliberately excluded: seq
 * is the chronological record and never rewinds, so undoing a node's creation
 * must not hand its number to the next one. Transient flags (streaming,
 * pending, compute issues) aren't user edits and would produce empty steps.
 */
function trackedSlice(state: GraphStore) {
  return { nodes: state.nodes, edges: state.edges };
}

const GESTURE_QUIET_MS = 300;
let gestureTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Call right AFTER the first write of a continuous gesture (drag, resize,
 * slider sweep), which fires a store write per pointer move. That first write
 * is recorded — so undo returns to where the gesture started — and history is
 * then held until the gesture goes quiet, collapsing the rest into nothing.
 *
 * Scoped to those three actions on purpose: a blanket time-based filter would
 * also swallow deliberate edits made in quick succession.
 */
function holdHistoryDuringGesture(): void {
  if (gestureTimer === null) pauseHistory();
  else clearTimeout(gestureTimer);
  gestureTimer = setTimeout(() => {
    gestureTimer = null;
    resumeHistory();
  }, GESTURE_QUIET_MS);
}

export const useGraphStore = create<GraphState & GraphActions>()(
  temporal(
    (set, get) => {
      // seq is the single source of truth for chronological order — never reused,
      // never renumbered; deletes never decrement the counter.
      function nextSeq(): number {
        const session = get().session;
        if (!session) throw new Error('no active session');
        const seq = session.seqCounter + 1;
        set({ session: { ...session, seqCounter: seq } });
        markDirty({ session: true });
        return seq;
      }

      function putNode(node: RNode): void {
        commit({ nodes: [node] });
      }

      /**
       * One state transition per user action. History records a step per
       * tracked write, so an action that wrote its node and its edge
       * separately would cost two presses of undo to reverse; writing once
       * keeps "one action, one undo" true and re-renders the canvas once.
       */
      function commit(change: {
        nodes?: RNode[];
        edges?: REdge[];
        removeNodeIds?: string[];
        removeEdgeIds?: string[];
      }): void {
        const { nodes = [], edges = [], removeNodeIds = [], removeEdgeIds = [] } = change;
        if (
          nodes.length === 0 &&
          edges.length === 0 &&
          removeNodeIds.length === 0 &&
          removeEdgeIds.length === 0
        ) {
          return;
        }
        set((s) => {
          const nextNodes =
            nodes.length || removeNodeIds.length ? { ...s.nodes } : (s.nodes as typeof s.nodes);
          for (const n of nodes) nextNodes[n.id] = n;
          for (const id of removeNodeIds) delete nextNodes[id];

          const nextEdges =
            edges.length || removeEdgeIds.length ? { ...s.edges } : (s.edges as typeof s.edges);
          for (const e of edges) nextEdges[e.id] = e;
          for (const id of removeEdgeIds) delete nextEdges[id];

          return { nodes: nextNodes, edges: nextEdges };
        });
        markDirty({
          nodeIds: nodes.map((n) => n.id),
          edgeIds: edges.map((e) => e.id),
          deletedNodeIds: removeNodeIds,
          deletedEdgeIds: removeEdgeIds,
        });
      }

      function runRecompute(): void {
        const { nodes, edges } = get();
        const { values, issues } = recomputeGraph(nodes, edges);
        const updated: RNode[] = [];
        for (const [id, value] of Object.entries(values)) {
          const node = nodes[id];
          if (node?.formula !== undefined && node.value !== value) {
            updated.push({ ...node, value });
          }
        }
        commit({ nodes: updated });
        set({ computeIssues: issues });
      }

      return {
        session: null,
        nodes: {},
        edges: {},
        streamingNodeId: null,
        pendingQuestionId: null,
        computeIssues: {},
        lessonComplete: false,
        sessionsRevision: 0,

        async createSession(title) {
          const session: Session = {
            id: newId(),
            title,
            mode: 'learn',
            createdAt: Date.now(),
            seqCounter: 0,
          };
          set({
            session,
            nodes: {},
            edges: {},
            streamingNodeId: null,
            pendingQuestionId: null,
            lessonComplete: false,
          });
          markDirty({ session: true });
          await flushNow();
          set((s) => ({ sessionsRevision: s.sessionsRevision + 1 }));
          clearHistory();
          return session.id;
        },

        async loadSession(id) {
          const session = await db.sessions.get(id);
          if (!session) return false;
          const [nodes, edges] = await Promise.all([
            db.nodes.where('sessionId').equals(id).toArray(),
            db.edges.where('sessionId').equals(id).toArray(),
          ]);
          set({
            session,
            nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
            edges: Object.fromEntries(edges.map((e) => [e.id, e])),
            streamingNodeId: null,
            pendingQuestionId: null,
            computeIssues: {},
            lessonComplete: false,
          });
          runRecompute();
          clearHistory();
          return true;
        },

        addChunk(md) {
          const { session, nodes } = get();
          if (!session) throw new Error('no active session');
          const chunks = Object.values(nodes)
            .filter((n) => n.kind === 'chunk')
            .sort((a, b) => a.seq - b.seq);
          const prev = chunks[chunks.length - 1];
          const node: RNode = {
            id: newId(),
            sessionId: session.id,
            kind: 'chunk',
            seq: nextSeq(),
            position: spinePosition(chunks.length),
            content: { md, highlights: [] },
          };
          commit({
            nodes: [node],
            edges: prev
              ? [
                  {
                    id: newId(),
                    sessionId: session.id,
                    kind: 'next',
                    source: prev.id,
                    target: node.id,
                  },
                ]
              : [],
          });
          return node.id;
        },

        addWhyBranch(parentId, sel, intent = 'why') {
          const { session, nodes, edges } = get();
          if (!session) throw new Error('no active session');
          const parent = nodes[parentId];
          if (!parent) throw new Error(`unknown parent node ${parentId}`);

          const questionId = newId();
          const highlight: Highlight = {
            id: newId(),
            start: sel.start,
            end: sel.end,
            text: sel.text,
            childNodeId: questionId,
          };

          const depth = branchDepth(parentId, edges) + 1;
          const siblingIndex = whySiblingCount(parentId, edges);
          const question: RNode = {
            id: questionId,
            sessionId: session.id,
            kind: 'question',
            seq: nextSeq(),
            position: branchPosition(parent, depth, siblingIndex),
            branchIntent: intent,
            content: { md: `> ${sel.text}`, highlights: [] },
          };

          const updatedParent: RNode = {
            ...parent,
            content: { ...parent.content, highlights: [...parent.content.highlights, highlight] },
          };
          commit({
            nodes: [updatedParent, question],
            edges: [
              {
                id: newId(),
                sessionId: session.id,
                kind: 'why',
                source: parentId,
                target: questionId,
              },
            ],
          });
          set({ pendingQuestionId: questionId });
          return questionId;
        },

        // A free-form "new idea" branch off a whole node — a question node with no
        // text highlight (a zero-width anchor keeps the branch⇄parent link without
        // underlining the entire note).
        addIdeaBranch(parentId) {
          return get().addWhyBranch(parentId, { start: 0, end: 0, text: '' }, 'idea');
        },

        // Remove a node and its whole branch subtree (its question→answer chain and
        // any deeper branches). Edges touching a removed node go too, and the parent
        // node's highlight that anchored this branch is cleaned up. seq is NOT
        // decremented — the chronological counter never rewinds (spec invariant);
        // only the visible #N badge renumbers, because it shows rank among current
        // nodes (see App.tsx).
        deleteNode(nodeId) {
          const { nodes, edges } = get();
          if (!nodes[nodeId]) return;

          const doomed = collectSubtree(nodeId, edges);
          const doomedEdgeIds = Object.values(edges)
            .filter((e) => doomed.has(e.source) || doomed.has(e.target))
            .map((e) => e.id);

          const nextNodes = { ...nodes };
          const parentUpdates: RNode[] = [];
          for (const n of Object.values(nodes)) {
            if (doomed.has(n.id)) continue;
            const highlights = n.content.highlights;
            if (highlights.some((h) => h.childNodeId && doomed.has(h.childNodeId))) {
              const updated: RNode = {
                ...n,
                content: {
                  ...n.content,
                  highlights: highlights.filter(
                    (h) => !(h.childNodeId && doomed.has(h.childNodeId)),
                  ),
                },
              };
              nextNodes[n.id] = updated;
              parentUpdates.push(updated);
            }
          }
          for (const id of doomed) delete nextNodes[id];

          const nextEdges = { ...edges };
          for (const id of doomedEdgeIds) delete nextEdges[id];

          set((s) => ({
            nodes: nextNodes,
            edges: nextEdges,
            pendingQuestionId:
              s.pendingQuestionId && doomed.has(s.pendingQuestionId) ? null : s.pendingQuestionId,
            streamingNodeId:
              s.streamingNodeId && doomed.has(s.streamingNodeId) ? null : s.streamingNodeId,
          }));
          markDirty({
            nodeIds: parentUpdates.map((n) => n.id),
            deletedNodeIds: [...doomed],
            deletedEdgeIds: doomedEdgeIds,
          });
        },

        submitQuestion(questionId, questionText) {
          const { session, nodes } = get();
          if (!session) throw new Error('no active session');
          const question = nodes[questionId];
          if (!question || question.kind !== 'question') {
            throw new Error(`unknown question node ${questionId}`);
          }

          const finalized: RNode = {
            ...question,
            content: { ...question.content, md: `${question.content.md}\n\n${questionText}` },
          };

          const answer: RNode = {
            id: newId(),
            sessionId: session.id,
            kind: 'answer',
            seq: nextSeq(),
            position: answerPosition(question),
            content: { md: '', highlights: [] },
          };
          commit({
            nodes: [finalized, answer],
            edges: [
              {
                id: newId(),
                sessionId: session.id,
                kind: 'reply',
                source: questionId,
                target: answer.id,
              },
            ],
          });
          set({ pendingQuestionId: null, streamingNodeId: answer.id });
          return answer.id;
        },

        appendToNode(nodeId, delta) {
          const node = get().nodes[nodeId];
          if (!node) return;
          putNode({ ...node, content: { ...node.content, md: node.content.md + delta } });
        },

        setNodeMd(nodeId, md) {
          const node = get().nodes[nodeId];
          if (!node) return;
          putNode({ ...node, content: { ...node.content, md } });
        },

        // Re-point this node's highlights at their quoted text. Call after the
        // node's markdown has been replaced (Regenerate) — the stored offsets refer
        // to the old text and would otherwise underline whatever now sits at those
        // character positions.
        reanchorNodeHighlights(nodeId) {
          const node = get().nodes[nodeId];
          if (!node || node.content.highlights.length === 0) return;
          const highlights = reanchorHighlights(node.content.md, node.content.highlights);
          const changed = highlights.some((h, i) => h !== node.content.highlights[i]);
          if (!changed) return;
          putNode({ ...node, content: { ...node.content, highlights } });
        },

        setStreamingNode(nodeId) {
          set({ streamingNodeId: nodeId });
        },

        setLessonComplete(complete) {
          set({ lessonComplete: complete });
        },

        finishStreaming() {
          set({ streamingNodeId: null });
        },

        setNodePosition(nodeId, position) {
          const node = get().nodes[nodeId];
          if (!node) return;
          putNode({ ...node, position });
          holdHistoryDuringGesture();
        },

        setNodeSize(nodeId, size) {
          const node = get().nodes[nodeId];
          if (!node) return;
          putNode({ ...node, size });
          holdHistoryDuringGesture();
        },

        toggleUnderstood(nodeId) {
          const node = get().nodes[nodeId];
          if (!node) return;
          putNode({ ...node, understood: !node.understood });
        },

        // `metrics` carries the sizes React Flow actually measured on screen —
        // without them a long lesson card gets laid out as if it were EST_H tall
        // and everything packed below it ends up underneath it.
        tidyLayout(metrics) {
          const { nodes, edges } = get();
          const positions = computeLayout(nodes, edges, metrics);
          const moved: RNode[] = [];
          for (const [id, position] of Object.entries(positions)) {
            const node = nodes[id];
            if (node && (node.position.x !== position.x || node.position.y !== position.y)) {
              moved.push({ ...node, position });
            }
          }
          commit({ nodes: moved });
        },

        setPlaygroundParams(nodeId, params) {
          const node = get().nodes[nodeId];
          if (!node?.playground) return;
          putNode({ ...node, playground: { ...node.playground, params } });
        },

        setVariableValue(nodeId, value) {
          const node = get().nodes[nodeId];
          if (!node || node.kind !== 'variable') return;
          putNode({ ...node, value });
          runRecompute();
          holdHistoryDuringGesture();
        },

        recompute() {
          runRecompute();
        },

        setPendingQuestion(questionId) {
          set({ pendingQuestionId: questionId });
        },

        async applyImport(payload) {
          set({
            session: payload.session,
            nodes: Object.fromEntries(payload.nodes.map((n) => [n.id, n])),
            edges: Object.fromEntries(payload.edges.map((e) => [e.id, e])),
            streamingNodeId: null,
            pendingQuestionId: null,
            computeIssues: {},
            lessonComplete: false,
          });
          runRecompute();
          markDirty({
            session: true,
            nodeIds: payload.nodes.map((n) => n.id),
            edgeIds: payload.edges.map((e) => e.id),
          });
          await flushNow();
          set((s) => ({ sessionsRevision: s.sessionsRevision + 1 }));
          clearHistory();
        },
      };
    },
    {
      partialize: trackedSlice,
      limit: 60,
      // Graph mutations always replace the nodes/edges maps, so identity is a
      // sound and cheap "did anything actually change" test.
      equality: (a, b) => a.nodes === b.nodes && a.edges === b.edges,
    },
  ),
);

initPersistence(() => {
  const { session, nodes, edges } = useGraphStore.getState();
  return { session, nodes, edges };
});
