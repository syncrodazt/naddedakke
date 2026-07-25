import { useGraphStore } from '../store/graphStore';
import { mockService, teachService } from './claude';
import { LESSON_DONE_MARKER, type LessonChunkRequest } from './claude/types';
import { withFallback } from './stream';
import { isAbort, useLlmStore } from '../store/llmStore';
import { pauseHistory, resumeHistory } from '../store/history';

// Chunked teaching flow: the model writes the lesson ONE chunk at a time
// (Socratic style — small chunk, then wait for the user to ask for the next).

/** Create a fresh learn session for a topic and stream its first chunk. */
export async function startLesson(topic: string): Promise<string> {
  await useGraphStore.getState().createSession(topic);
  return nextLessonChunk();
}

/** Request the next spine chunk; returns the new chunk node id. */
export async function nextLessonChunk(): Promise<string> {
  const store = useGraphStore.getState();
  const { session, nodes } = store;
  if (!session) throw new Error('no active session');

  const previousChunksMd = Object.values(nodes)
    .filter((n) => n.kind === 'chunk')
    .sort((a, b) => a.seq - b.seq)
    .map((n) => n.content.md);

  const llm = useLlmStore.getState();
  const req: LessonChunkRequest = {
    sessionId: session.id,
    topic: session.title,
    previousChunksMd,
    chunkIndex: previousChunksMd.length,
    signal: llm.begin(),
  };

  // Created while history is live, so undo removes the chunk; the streamed body
  // that follows is a machine burst and is not recorded.
  const chunkId = store.addChunk('');
  store.setStreamingNode(chunkId);
  pauseHistory();
  try {
    const stream = withFallback(
      teachService.streamLessonChunk(req),
      () => mockService.streamLessonChunk(req),
      llm.noteFallback,
    );
    for await (const delta of stream) {
      if (req.signal?.aborted) break; // also halts a mock fallback stream
      useGraphStore.getState().appendToNode(chunkId, delta);
    }
  } catch (err) {
    if (!isAbort(err)) throw err;
  } finally {
    useLlmStore.getState().end();
    useGraphStore.getState().finishStreaming();
  }

  // The final line may carry the lesson-complete marker — strip it.
  const md = useGraphStore.getState().nodes[chunkId]?.content.md ?? '';
  if (md.trimEnd().endsWith(LESSON_DONE_MARKER)) {
    const stripped = md.trimEnd().slice(0, -LESSON_DONE_MARKER.length).trimEnd();
    useGraphStore.getState().setNodeMd(chunkId, stripped);
    useGraphStore.getState().setLessonComplete(true);
  }
  // Resume only once the text has fully settled, so the marker strip doesn't
  // land as its own undo step.
  resumeHistory();
  return chunkId;
}
