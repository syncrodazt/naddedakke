import { useGraphStore } from '../store/graphStore';
import { mockService, teachService } from './claude';
import type { LessonChunkRequest } from './claude/types';
import { LessonStreamParser, composeChunkMd } from './lessonStream';
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
    await consumeChunkStream(chunkId, stream, req.signal);
  } catch (err) {
    if (!isAbort(err)) throw err;
  } finally {
    useLlmStore.getState().end();
    useGraphStore.getState().finishStreaming();
  }

  // Resume only once the text has fully settled, so composing the final body
  // doesn't land as its own undo step.
  resumeHistory();
  return chunkId;
}

/**
 * Drive one lesson-chunk stream into a node.
 *
 * The model replies with a JSON object; LessonStreamParser renders its `md`
 * field live as it arrives, so structured output costs no interactivity, and
 * JSON syntax never reaches the node body. When the stream ends the app — not
 * the model — appends the comprehension check in the exact blockquote form
 * findCheckRange recognises, which is what stops the Socratic loop from
 * silently disappearing whenever the model forgot the marker.
 *
 * A provider that ignores the instruction and streams plain markdown still
 * works: the parser passes it straight through.
 */
export async function consumeChunkStream(
  chunkId: string,
  stream: AsyncGenerator<string>,
  signal: AbortSignal | undefined,
): Promise<void> {
  const parser = new LessonStreamParser();
  for await (const delta of stream) {
    if (signal?.aborted) break; // also halts a mock fallback stream
    const text = parser.push(delta);
    if (text !== '') useGraphStore.getState().appendToNode(chunkId, text);
  }
  const chunk = parser.finish();
  if (!chunk) return; // plain markdown: what streamed is already the body
  useGraphStore.getState().setNodeMd(chunkId, composeChunkMd(chunk));
  if (chunk.done) useGraphStore.getState().setLessonComplete(true);
}
