import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushNow, markDirty, setGuestSink } from '../db/persistence';
import { db } from '../db/db';
import { useGraphStore } from '../store/graphStore';
import type { SessionExport } from '../model/types';
import type { Snapshot } from '../db/persistence';

// A guest is standing in someone else's notebook. The invariant these tests
// protect is that nothing about that notebook reaches the guest's own storage:
// it is not theirs to keep, and a copy left behind in their library would
// outlive the link that granted it.

function exportOf(id: string, title: string): SessionExport {
  return {
    schemaVersion: 1,
    session: { id, title, mode: 'learn', createdAt: 1, seqCounter: 1 },
    nodes: [
      {
        id: `${id}-n1`,
        sessionId: id,
        kind: 'chunk',
        seq: 1,
        position: { x: 0, y: 0 },
        content: { md: 'shared body', highlights: [] },
      },
    ],
    edges: [],
  };
}

async function clearDb() {
  await db.transaction('rw', db.sessions, db.nodes, db.edges, async () => {
    await db.sessions.clear();
    await db.nodes.clear();
    await db.edges.clear();
  });
}

beforeEach(async () => {
  setGuestSink(null);
  await clearDb();
  useGraphStore.setState({ session: null, nodes: {}, edges: {} });
});

afterEach(() => {
  setGuestSink(null);
});

describe('loadGuestSession', () => {
  it('puts the notebook on the canvas', () => {
    useGraphStore.getState().loadGuestSession(exportOf('shared', 'Someone else’s'));
    const state = useGraphStore.getState();
    expect(state.session?.title).toBe('Someone else’s');
    expect(Object.keys(state.nodes)).toHaveLength(1);
  });

  it('writes nothing to the local database', async () => {
    useGraphStore.getState().loadGuestSession(exportOf('shared', 'Someone else’s'));
    await flushNow();
    // The guest's own library must not gain a notebook they do not own.
    expect(await db.sessions.count()).toBe(0);
    expect(await db.nodes.count()).toBe(0);
  });
});

describe('guest sink', () => {
  it('takes edits instead of the local database', async () => {
    useGraphStore.getState().loadGuestSession(exportOf('shared', 'Shared'));
    const sink = vi.fn<(snapshot: Snapshot) => void>();
    setGuestSink(sink);

    const nodeId = Object.keys(useGraphStore.getState().nodes)[0]!;
    useGraphStore.getState().appendToNode(nodeId, ' — edited');
    await flushNow();

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]![0].nodes[nodeId]!.content.md).toBe('shared body — edited');
    expect(await db.nodes.count()).toBe(0);
  });

  it('is not called when nothing changed', async () => {
    const sink = vi.fn<(snapshot: Snapshot) => void>();
    setGuestSink(sink);
    await flushNow();
    expect(sink).not.toHaveBeenCalled();
  });

  it('clears what it consumed, so one edit is pushed once', async () => {
    useGraphStore.getState().loadGuestSession(exportOf('shared', 'Shared'));
    const sink = vi.fn<(snapshot: Snapshot) => void>();
    setGuestSink(sink);

    const nodeId = Object.keys(useGraphStore.getState().nodes)[0]!;
    useGraphStore.getState().appendToNode(nodeId, '!');
    await flushNow();
    await flushNow();

    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('hands local writes back to Dexie once it is removed', async () => {
    setGuestSink(vi.fn());
    setGuestSink(null);
    await useGraphStore.getState().createSession('mine');
    useGraphStore.getState().addChunk('body');
    await flushNow();
    expect(await db.sessions.count()).toBe(1);
    expect(await db.nodes.count()).toBe(1);
  });

  it('does not leak a queued local write into the guest sink', async () => {
    // Something was dirty before the guest took over. It must not be pushed to
    // the share — it belongs to the learner's own notebook.
    await useGraphStore.getState().createSession('mine');
    useGraphStore.getState().addChunk('private body');
    await flushNow();
    const before = await db.nodes.count();

    useGraphStore.getState().loadGuestSession(exportOf('shared', 'Shared'));
    const sink = vi.fn<(snapshot: Snapshot) => void>();
    setGuestSink(sink);
    markDirty({ session: true });
    await flushNow();

    // The push carries the SHARED notebook, never the private one.
    expect(sink.mock.calls[0]![0].session?.id).toBe('shared');
    expect(await db.nodes.count()).toBe(before);
  });
});
