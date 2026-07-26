import { beforeEach, describe, expect, it } from 'vitest';
import { useGraphStore } from '../store/graphStore';
import { flushNow } from '../db/persistence';
import { db } from '../db/db';
import { consumeChunkStream, startLesson, nextLessonChunk } from './lesson';
import { findCheckRange } from './checkQuestion';

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

  it('chains chunks with next edges and flags the lesson complete at the end', async () => {
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
    // The body is markdown, never the JSON envelope it arrived in.
    expect(nodes[last]!.content.md).not.toContain('chunkTitle');
    expect(nodes[last]!.content.md.trimStart().startsWith('{')).toBe(false);
  });

  it('never shows JSON syntax in the node while the chunk streams', async () => {
    // The final body is rewritten when the stream ends, so checking only the
    // end state would pass even if the learner watched `{"chunkTitle":"…`
    // scroll past first. Assert after every delta instead.
    await startLesson('ストリーム');
    const chunkId = useGraphStore.getState().addChunk('');
    const payload = JSON.stringify({
      chunkTitle: 'T',
      md: '## T\n\n本文です。',
      checkQuestion: 'なぜ？',
      done: false,
    });
    const seen: string[] = [];
    async function* deltas(): AsyncGenerator<string> {
      for (let i = 0; i < payload.length; i += 5) {
        yield payload.slice(i, i + 5);
        // Resumes only after the consumer has appended this delta.
        seen.push(useGraphStore.getState().nodes[chunkId]!.content.md);
      }
    }
    await consumeChunkStream(chunkId, deltas(), undefined);

    for (const md of seen) {
      expect(md, `leaked JSON: ${md}`).not.toMatch(/chunkTitle|checkQuestion|\{"/);
    }
    expect(seen[seen.length - 1]).toContain('本文です。');
  });

  it('always leaves a findable comprehension check on the chunk', async () => {
    // The app composes the "> ❓ …" line from the model's checkQuestion field
    // rather than hoping the model formatted it, so the Socratic loop cannot
    // silently vanish. findCheckRange is what the 答える button depends on.
    const chunkId = await startLesson('確認テスト');
    const md = useGraphStore.getState().nodes[chunkId]!.content.md;
    const range = findCheckRange(md)!;
    expect(range).not.toBeNull();
    expect(md.slice(range.start, range.end)).toBe(range.text);
    expect(range.text.length).toBeGreaterThan(0);
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
