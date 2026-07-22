import { create } from 'zustand';
import type { Highlight, REdge, RNode, Session, SessionExport } from '../model/types';
import { newId } from '../model/ids';
import { db } from '../db/db';
import { flushNow, initPersistence, markDirty } from '../db/persistence';
import {
  answerPosition,
  branchDepth,
  branchPosition,
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
};

type GraphActions = {
  createSession: (title: string) => Promise<string>;
  loadSession: (id: string) => Promise<boolean>;
  addChunk: (md: string) => string;
  addWhyBranch: (parentId: string, sel: SelectionRange) => string;
  submitQuestion: (questionId: string, questionText: string) => string;
  appendToNode: (nodeId: string, delta: string) => void;
  finishStreaming: () => void;
  setNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  setPlaygroundParams: (nodeId: string, params: Record<string, number>) => void;
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

  return {
    session: null,
    nodes: {},
    edges: {},
    streamingNodeId: null,
    pendingQuestionId: null,

    async createSession(title) {
      const session: Session = {
        id: newId(),
        title,
        mode: 'learn',
        createdAt: Date.now(),
        seqCounter: 0,
      };
      set({ session, nodes: {}, edges: {}, streamingNodeId: null, pendingQuestionId: null });
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
      });
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

    addWhyBranch(parentId, sel) {
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

    finishStreaming() {
      set({ streamingNodeId: null });
    },

    setNodePosition(nodeId, position) {
      const node = get().nodes[nodeId];
      if (!node) return;
      putNode({ ...node, position });
    },

    setPlaygroundParams(nodeId, params) {
      const node = get().nodes[nodeId];
      if (!node?.playground) return;
      putNode({ ...node, playground: { ...node.playground, params } });
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
      });
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
