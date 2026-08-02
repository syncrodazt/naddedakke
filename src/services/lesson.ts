import { useGraphStore } from '../store/graphStore';
import { currentDisplay } from '../store/displayContent';
import { mockService, teachService } from './claude';
import type { LessonChunkRequest } from './claude/types';
import { LessonPlanError, nextPlanStep, parsePlan } from './plan';
import { usePlanStore } from '../lesson/planStore';
import { langLabel } from '../i18n/langLabel';
import { LessonStreamParser, composeChunkMd } from './lessonStream';
import { withFallback } from './stream';
import { isAbort, useLlmStore } from '../store/llmStore';
import { pauseHistory, resumeHistory } from '../store/history';

// The teaching flow: plan the whole lesson first, then write it one step at a
// time against that plan (Socratic — small step, then wait), or all at once if
// the learner would rather read it whole.
//
// The plan comes first because a lesson delivered card by card is unreadable as
// an argument: you cannot tell whether you are three steps from the point or
// thirty, and every "next" is an act of faith. Showing the ten titles up front
// costs one call and answers that permanently. It is not the same as dumping
// the lesson — a title and a one-line gist are not the teaching.

/**
 * Plan the lesson for the current session and store it.
 *
 * Failure is not fatal. A notebook with no plan teaches exactly the way it used
 * to, one chunk at a time — worse, but not broken, and much better than
 * refusing to start because the planning call went wrong.
 */
export async function planCurrentLesson(): Promise<boolean> {
  const store = useGraphStore.getState();
  const session = store.session;
  if (!session) throw new Error('no active session');

  const llm = useLlmStore.getState();
  const req = { topic: session.title, langLabel: langLabel(), signal: llm.begin() };
  usePlanStore.getState().setPlanning(true);
  try {
    const raw = await teachService.planLesson(req);
    useGraphStore.getState().setOutline(parsePlan(raw));
    usePlanStore.getState().show();
    return true;
  } catch (err) {
    if (isAbort(err)) return false;
    // A provider that is unreachable falls back to the mock, same as the rest
    // of the app; anything else is reported and the lesson goes on without one.
    if (!(err instanceof LessonPlanError)) {
      try {
        useGraphStore.getState().setOutline(parsePlan(await mockService.planLesson(req)));
        useLlmStore.getState().noteFallback(err);
        usePlanStore.getState().show();
        return true;
      } catch {
        // fall through to reporting the original failure
      }
    }
    useLlmStore.getState().noteFallback(err);
    return false;
  } finally {
    usePlanStore.getState().setPlanning(false);
    useLlmStore.getState().end();
  }
}

/** Create a fresh learn session for a topic, plan it, and stream its first step. */
export async function startLesson(topic: string): Promise<string> {
  await useGraphStore.getState().createSession(topic);
  await planCurrentLesson();
  return nextLessonChunk();
}

/**
 * Teach every remaining step of the plan, back to back.
 *
 * The alternative to pressing Next ten times, for when the learner wants the
 * whole thing to read rather than to be walked through it. Stops early if the
 * model says the lesson is done, or if the learner cancels — each step is a
 * normal chunk, so a half-finished run leaves a notebook that is simply
 * shorter, never a broken one.
 */
export async function teachRemainingSteps(): Promise<void> {
  const outline = useGraphStore.getState().session?.outline;
  if (!outline) return;
  usePlanStore.getState().startRun(outline.length);
  try {
    for (;;) {
      const { session, nodes, lessonComplete } = useGraphStore.getState();
      const steps = session?.outline;
      if (!steps || lessonComplete) return;
      const next = nextPlanStep(nodes, steps);
      if (next === null) return;
      if (usePlanStore.getState().cancelled) return;
      usePlanStore.getState().noteRunStep(next);
      await nextLessonChunk();
    }
  } finally {
    usePlanStore.getState().endRun();
  }
}

/** Request the next spine chunk; returns the new chunk node id. */
export async function nextLessonChunk(): Promise<string> {
  const store = useGraphStore.getState();
  const { session, nodes } = store;
  if (!session) throw new Error('no active session');

  const previousChunksMd = Object.values(nodes)
    .filter((n) => n.kind === 'chunk')
    .sort((a, b) => a.seq - b.seq)
    .map((n) => currentDisplay(n).md);

  // Which step of the plan this is. Read off the chunks rather than counted, so
  // a deleted or spliced-in chunk cannot make the lesson skip a step.
  const outline = session.outline;
  const stepIndex = outline ? nextPlanStep(nodes, outline) : null;

  const llm = useLlmStore.getState();
  const req: LessonChunkRequest = {
    sessionId: session.id,
    topic: session.title,
    previousChunksMd,
    chunkIndex: previousChunksMd.length,
    ...(outline && stepIndex !== null ? { plan: { steps: outline, stepIndex } } : {}),
    signal: llm.begin(),
  };

  // Created while history is live, so undo removes the chunk; the streamed body
  // that follows is a machine burst and is not recorded.
  const chunkId = store.addChunk('', stepIndex ?? undefined);
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

/**
 * Ask what must be understood before a node, and stream it into a fresh chunk
 * spliced in ahead of that node. Returns the new chunk's id.
 *
 * Same machinery as a normal lesson step — one chunk, streamed, with its own
 * comprehension check — because that is what it is. Only its place in the chain
 * differs.
 */
export async function prerequisiteChunk(targetNodeId: string): Promise<string> {
  const store = useGraphStore.getState();
  const { session, nodes } = store;
  if (!session) throw new Error('no active session');
  const target = nodes[targetNodeId];
  if (!target) throw new Error(`unknown node ${targetNodeId}`);

  const llm = useLlmStore.getState();
  const req: LessonChunkRequest = {
    sessionId: session.id,
    topic: session.title,
    previousChunksMd: [],
    chunkIndex: 0,
    prerequisiteFor: currentDisplay(target).md,
    signal: llm.begin(),
  };

  // Created while history is live, so undo removes it; the streamed body that
  // follows is a machine burst and is not recorded.
  const chunkId = store.insertPrerequisite(targetNodeId);
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
  // A prerequisite never ends the lesson, whatever the model claims.
  useGraphStore.getState().setLessonComplete(false);
  resumeHistory();
  return chunkId;
}
