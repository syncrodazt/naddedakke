import { beforeEach, describe, expect, it } from 'vitest';
import { useGraphStore } from '../store/graphStore';
import { flushNow } from '../db/persistence';
import { db } from '../db/db';
import { startLesson, nextLessonChunk } from './lesson';
import { LESSON_DONE_MARKER } from './claude/types';

// In the test environment fetch('/api/chat') fails immediately, so the
// lesson flow exercises the real→mock fallback path end to end.

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
    computeIssues: {},
    lessonComplete: false,
  });
}

describe('chunked lesson flow', () => {
  beforeEach(resetAll);

  it('creates a session titled by topic and streams the first chunk', async () => {
    const chunkId = await startLesson('ベイズの定理');
    const { session, nodes, streamingNodeId } = useGraphStore.getState();
    expect(session?.title).toBe('ベイズの定理');
    expect(session?.mode).toBe('learn');
    const chunk = nodes[chunkId]!;
    expect(chunk.kind).toBe('chunk');
    expect(chunk.content.md).toContain('ベイズの定理');
    expect(chunk.content.md.length).toBeGreaterThan(10);
    expect(streamingNodeId).toBeNull(); // finished
  });

  it('chains chunks with next edges and strips the done marker at the end', async () => {
    await startLesson('トピックX');
    await nextLessonChunk();
    const last = await nextLessonChunk(); // mock lesson completes at chunk 3

    const { nodes, edges, lessonComplete } = useGraphStore.getState();
    const chunks = Object.values(nodes)
      .filter((n) => n.kind === 'chunk')
      .sort((a, b) => a.seq - b.seq);
    expect(chunks).toHaveLength(3);
    const nextEdges = Object.values(edges).filter((e) => e.kind === 'next');
    expect(nextEdges).toHaveLength(2);

    expect(lessonComplete).toBe(true);
    expect(nodes[last]!.content.md).not.toContain(LESSON_DONE_MARKER);
  });

  it('places chunks left to right on the spine', async () => {
    await startLesson('トピックY');
    await nextLessonChunk();
    const chunks = Object.values(useGraphStore.getState().nodes)
      .filter((n) => n.kind === 'chunk')
      .sort((a, b) => a.seq - b.seq);
    expect(chunks[1]!.position.x).toBeGreaterThan(chunks[0]!.position.x);
    expect(chunks[1]!.position.y).toBe(chunks[0]!.position.y);
  });
});
