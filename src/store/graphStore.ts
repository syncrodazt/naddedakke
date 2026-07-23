import { create } from 'zustand';
import type { Highlight, REdge, RNode, Session, SessionExport } from '../model/types';
import { newId } from '../model/ids';
import { recomputeGraph } from '../gyakusan/engine';
import { db } from '../db/db';
import { flushNow, initPersistence, markDirty } from '../db/persistence';
import { collectSubtree } from './subtree';
import {
  answerPosition,
  branchDepth,
  branchPosition,
  computeLayout,
  spinePosition,
  whySiblingCount,
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
  setStreamingNode: (nodeId: string | null) => void;
  setLessonComplete: (complete: boolean) => void;
  finishStreaming: () => void;
  setNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  setNodeSize: (nodeId: string, size: { width: number; height: number }) => void;
  toggleUnderstood: (nodeId: string) => void;
  tidyLayout: () => void;
  setPlaygroundParams: (nodeId: string, params: Record<string, number>) => void;
  setVariableValue: (nodeId: string, value: number) => void;
  recompute: () => void;
  setPendingQuestion: (questionId: string | null) => void;
  applyImport: (payload: SessionExport) => Promise<void>;
};

export const useGraphStore = create<GraphState & GraphActions>()((set, get) => {
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
    set((s) => ({ nodes: { ...s.nodes, [node.id]: node } }));
    markDirty({ nodeIds: [node.id] });
  }

  function putEdge(edge: REdge): void {
    set((s) => ({ edges: { ...s.edges, [edge.id]: edge } }));
    markDirty({ edgeIds: [edge.id] });
  }

  function runRecompute(): void {
    const { nodes, edges } = get();
    const { values, issues } = recomputeGraph(nodes, edges);
    for (const [id, value] of Object.entries(values)) {
      const node = nodes[id];
      if (node?.formula !== undefined && node.value !== value) {
        putNode({ ...node, value });
      }
    }
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
      putNode(node);
      if (prev) {
        putEdge({
          id: newId(),
          sessionId: session.id,
          kind: 'next',
          source: prev.id,
          target: node.id,
        });
      }
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
      putNode(updatedParent);
      putNode(question);
      putEdge({
        id: newId(),
        sessionId: session.id,
        kind: 'why',
        source: parentId,
        target: questionId,
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
              highlights: highlights.filter((h) => !(h.childNodeId && doomed.has(h.childNodeId))),
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
      putNode(finalized);

      const answer: RNode = {
        id: newId(),
        sessionId: session.id,
        kind: 'answer',
        seq: nextSeq(),
        position: answerPosition(question),
        content: { md: '', highlights: [] },
      };
      putNode(answer);
      putEdge({
        id: newId(),
        sessionId: session.id,
        kind: 'reply',
        source: questionId,
        target: answer.id,
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
    },

    setNodeSize(nodeId, size) {
      const node = get().nodes[nodeId];
      if (!node) return;
      putNode({ ...node, size });
    },

    toggleUnderstood(nodeId) {
      const node = get().nodes[nodeId];
      if (!node) return;
      putNode({ ...node, understood: !node.understood });
    },

    tidyLayout() {
      const { nodes, edges } = get();
      const positions = computeLayout(nodes, edges);
      for (const [id, position] of Object.entries(positions)) {
        const node = nodes[id];
        if (node && (node.position.x !== position.x || node.position.y !== position.y)) {
          putNode({ ...node, position });
        }
      }
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
    },
  };
});

initPersistence(() => {
  const { session, nodes, edges } = useGraphStore.getState();
  return { session, nodes, edges };
});
