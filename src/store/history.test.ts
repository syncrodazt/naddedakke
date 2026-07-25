import { beforeEach, describe, expect, it } from 'vitest';
import { useGraphStore } from './graphStore';
import { clearHistory, pauseHistory, redo, resumeHistory, undo } from './history';
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
  clearHistory();
}

const past = () => useGraphStore.temporal.getState().pastStates.length;

describe('undo / redo', () => {
  beforeEach(resetAll);

  it('restores a deleted node and its whole branch subtree', async () => {
    const store = useGraphStore.getState();
    await store.createSession('t');
    const chunk = store.addChunk('the sky scatters blue light');
    const q = store.addWhyBranch(chunk, { start: 8, end: 16, text: 'scatters' });
    const a = store.submitQuestion(q, 'why?');

    useGraphStore.getState().deleteNode(q);
    expect(useGraphStore.getState().nodes[q]).toBeUndefined();
    expect(useGraphStore.getState().nodes[a]).toBeUndefined();
    // the parent's highlight went with it
    expect(useGraphStore.getState().nodes[chunk]!.content.highlights).toHaveLength(0);

    await undo();
    const after = useGraphStore.getState();
    expect(after.nodes[q]).toBeDefined();
    expect(after.nodes[a]).toBeDefined();
    expect(after.nodes[chunk]!.content.highlights).toHaveLength(1);
    // the why edge is back too, so the branch is still anchored
    expect(Object.values(after.edges).some((e) => e.kind === 'why' && e.target === q)).toBe(true);
  });

  it('persists an undo, so the restored node survives a reload', async () => {
    const store = useGraphStore.getState();
    const sessionId = await store.createSession('t');
    const chunk = store.addChunk('hello');
    useGraphStore.getState().deleteNode(chunk);
    await flushNow();
    expect(await db.nodes.get(chunk)).toBeUndefined();

    await undo();
    expect(await db.nodes.get(chunk)).toBeDefined();

    // a real reload path
    await useGraphStore.getState().loadSession(sessionId);
    expect(useGraphStore.getState().nodes[chunk]).toBeDefined();
  });

  it('persists a redo, so re-deleting also survives a reload', async () => {
    const store = useGraphStore.getState();
    await store.createSession('t');
    const chunk = store.addChunk('hello');
    useGraphStore.getState().deleteNode(chunk);
    await undo();
    await redo();
    expect(useGraphStore.getState().nodes[chunk]).toBeUndefined();
    expect(await db.nodes.get(chunk)).toBeUndefined();
  });

  it('never rewinds the seq counter — undone numbers are not reused', async () => {
    const store = useGraphStore.getState();
    await store.createSession('t');
    store.addChunk('one');
    const second = useGraphStore.getState().addChunk('two');
    expect(useGraphStore.getState().nodes[second]!.seq).toBe(2);

    await undo(); // removes the second chunk
    expect(useGraphStore.getState().nodes[second]).toBeUndefined();

    const third = useGraphStore.getState().addChunk('three');
    // seq 2 belonged to a node that existed; it must not be handed out again.
    expect(useGraphStore.getState().nodes[third]!.seq).toBe(3);
  });

  it('records nothing while history is paused (streaming bursts)', async () => {
    const store = useGraphStore.getState();
    await store.createSession('t');
    const chunk = store.addChunk('');
    const before = past();

    pauseHistory();
    for (const token of ['a', 'b', 'c', 'd', 'e']) {
      useGraphStore.getState().appendToNode(chunk, token);
    }
    expect(past()).toBe(before);

    resumeHistory();
    expect(useGraphStore.getState().nodes[chunk]!.content.md).toBe('abcde');
  });

  it('nested pauses only resume once fully unwound', async () => {
    const store = useGraphStore.getState();
    await store.createSession('t');
    const chunk = store.addChunk('x');
    const before = past();

    pauseHistory();
    pauseHistory();
    resumeHistory();
    useGraphStore.getState().appendToNode(chunk, 'still paused');
    expect(past()).toBe(before);

    resumeHistory();
    useGraphStore.getState().appendToNode(chunk, '!');
    expect(past()).toBeGreaterThan(before);
  });

  it('drops history when the session is swapped, so undo cannot cross sessions', async () => {
    const store = useGraphStore.getState();
    const first = await store.createSession('one');
    useGraphStore.getState().addChunk('in session one');
    expect(past()).toBeGreaterThan(0);

    await useGraphStore.getState().createSession('two');
    expect(past()).toBe(0);

    await useGraphStore.getState().loadSession(first);
    expect(past()).toBe(0);
  });

  it('is a no-op when there is nothing to undo or redo', async () => {
    await useGraphStore.getState().createSession('t');
    await expect(undo()).resolves.toBeUndefined();
    await expect(redo()).resolves.toBeUndefined();
  });
});
