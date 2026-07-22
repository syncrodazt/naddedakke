import { beforeEach, describe, expect, it } from 'vitest';
import { useGraphStore } from './graphStore';
import { flushNow } from '../db/persistence';
import { db } from '../db/db';

async function resetAll() {
  await flushNow();
  await db.transaction('rw', db.sessions, db.nodes, db.edges, async () => {
    await db.sessions.clear();
    await db.nodes.clear();
    await db.edges.clear();
  });
  useGraphStore.setState({
    session: null,
    nodes: {},
    edges: {},
    streamingNodeId: null,
    pendingQuestionId: null,
  });
}

describe('seq ordering', () => {
  beforeEach(resetAll);

  it('assigns monotonic seqs to chunks and tracks the counter', async () => {
    const store = useGraphStore.getState();
    await store.createSession('test');
    const ids = [store.addChunk('one'), store.addChunk('two'), store.addChunk('three')];
    const { nodes, session } = useGraphStore.getState();
    expect(ids.map((id) => nodes[id]!.seq)).toEqual([1, 2, 3]);
    expect(session!.seqCounter).toBe(3);
  });

  it('links chunks with next edges in spine order', async () => {
    const store = useGraphStore.getState();
    await store.createSession('test');
    const a = store.addChunk('a');
    const b = store.addChunk('b');
    const edges = Object.values(useGraphStore.getState().edges);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ kind: 'next', source: a, target: b });
  });

  it('orders question before answer, both after existing nodes', async () => {
    const store = useGraphStore.getState();
    await store.createSession('test');
    const chunk = store.addChunk('the sky is blue because of scattering');
    const questionId = store.addWhyBranch(chunk, { start: 20, end: 30, text: 'scattering' });
    const answerId = store.submitQuestion(questionId, 'why is this the case?');
    const { nodes } = useGraphStore.getState();
    expect(nodes[questionId]!.seq).toBeGreaterThan(nodes[chunk]!.seq);
    expect(nodes[answerId]!.seq).toBeGreaterThan(nodes[questionId]!.seq);
  });

  it('never reuses seqs across interleaved branch creation', async () => {
    const store = useGraphStore.getState();
    await store.createSession('test');
    const c1 = store.addChunk('c1');
    const q1 = store.addWhyBranch(c1, { start: 0, end: 2, text: 'c1' });
    store.addChunk('c2');
    const a1 = store.submitQuestion(q1, 'why?');
    const q2 = store.addWhyBranch(a1, { start: 0, end: 1, text: 'x' });
    const seqs = Object.values(useGraphStore.getState().nodes).map((n) => n.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(Math.max(...seqs)).toBe(useGraphStore.getState().session!.seqCounter);
    expect(useGraphStore.getState().nodes[q2]!.seq).toBe(5);
  });

  it('persists the seq counter across flush and reload', async () => {
    const store = useGraphStore.getState();
    const sessionId = await store.createSession('test');
    store.addChunk('one');
    store.addChunk('two');
    await flushNow();

    useGraphStore.setState({ session: null, nodes: {}, edges: {} });
    const loaded = await useGraphStore.getState().loadSession(sessionId);
    expect(loaded).toBe(true);
    const { session, nodes } = useGraphStore.getState();
    expect(session!.seqCounter).toBe(2);
    expect(Object.keys(nodes)).toHaveLength(2);

    useGraphStore.getState().addChunk('three');
    expect(useGraphStore.getState().session!.seqCounter).toBe(3);
  });

  it('registers the highlight on the parent with childNodeId', async () => {
    const store = useGraphStore.getState();
    await store.createSession('test');
    const chunk = store.addChunk('alpha beta gamma');
    const questionId = store.addWhyBranch(chunk, { start: 6, end: 10, text: 'beta' });
    const parent = useGraphStore.getState().nodes[chunk]!;
    expect(parent.content.highlights).toHaveLength(1);
    expect(parent.content.highlights[0]).toMatchObject({
      start: 6,
      end: 10,
      text: 'beta',
      childNodeId: questionId,
    });
  });
});
