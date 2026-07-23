import { beforeEach, describe, expect, it } from 'vitest';
import { useGraphStore } from './graphStore';
import { collectSubtree } from './subtree';
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

// chunk → question → answer, plus a second chunk on the spine.
async function seedGraph() {
  const store = useGraphStore.getState();
  await store.createSession('t');
  const chunk = store.addChunk('the sky scatters blue light');
  const question = store.addWhyBranch(chunk, { start: 8, end: 15, text: 'scatter' });
  const answer = store.submitQuestion(question, 'why is this the case?');
  const chunk2 = store.addChunk('second chunk');
  return { chunk, question, answer, chunk2 };
}

describe('collectSubtree', () => {
  beforeEach(resetAll);

  it('gathers a node and its why/reply descendants but not spine siblings', async () => {
    const { chunk, question, answer, chunk2 } = await seedGraph();
    const { edges } = useGraphStore.getState();
    const sub = collectSubtree(chunk, edges);
    expect(sub.has(chunk)).toBe(true);
    expect(sub.has(question)).toBe(true);
    expect(sub.has(answer)).toBe(true);
    // chunk2 is a spine sibling (next edge), not a descendant.
    expect(sub.has(chunk2)).toBe(false);
  });

  it('a question subtree contains only the question and its answer', async () => {
    const { question, answer, chunk } = await seedGraph();
    const sub = collectSubtree(question, useGraphStore.getState().edges);
    expect([...sub].sort()).toEqual([question, answer].sort());
    expect(sub.has(chunk)).toBe(false);
  });
});

describe('deleteNode', () => {
  beforeEach(resetAll);

  it('removes a question with its answer, their edges, and the parent highlight', async () => {
    const { chunk, question, answer } = await seedGraph();
    useGraphStore.getState().deleteNode(question);
    const { nodes, edges } = useGraphStore.getState();
    expect(nodes[question]).toBeUndefined();
    expect(nodes[answer]).toBeUndefined();
    // The parent chunk survives, but its highlight (which anchored the branch) is gone.
    expect(nodes[chunk]).toBeDefined();
    expect(nodes[chunk]!.content.highlights).toHaveLength(0);
    // No dangling edges reference the deleted nodes.
    for (const e of Object.values(edges)) {
      expect(e.source).not.toBe(question);
      expect(e.target).not.toBe(question);
      expect(e.source).not.toBe(answer);
      expect(e.target).not.toBe(answer);
    }
  });

  it('does not decrement the seq counter (chronological record never rewinds)', async () => {
    const { question } = await seedGraph();
    const before = useGraphStore.getState().session!.seqCounter;
    useGraphStore.getState().deleteNode(question);
    expect(useGraphStore.getState().session!.seqCounter).toBe(before);
    // A node created after a delete still gets a fresh, higher seq.
    const newChunk = useGraphStore.getState().addChunk('after delete');
    expect(useGraphStore.getState().nodes[newChunk]!.seq).toBe(before + 1);
  });

  it('persists the deletion to Dexie', async () => {
    const { question, answer } = await seedGraph();
    useGraphStore.getState().deleteNode(question);
    await flushNow();
    expect(await db.nodes.get(question)).toBeUndefined();
    expect(await db.nodes.get(answer)).toBeUndefined();
  });

  it('clears pendingQuestionId when the pending node is deleted', async () => {
    const { chunk } = await seedGraph();
    // addWhyBranch sets pendingQuestionId to the new question.
    const q = useGraphStore.getState().addWhyBranch(chunk, { start: 0, end: 3, text: 'the' });
    expect(useGraphStore.getState().pendingQuestionId).toBe(q);
    useGraphStore.getState().deleteNode(q);
    expect(useGraphStore.getState().pendingQuestionId).toBeNull();
  });
});
