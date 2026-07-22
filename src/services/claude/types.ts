export type AnswerRequest = {
  sessionId: string;
  question: string; // the learner's text — a "why?" question, or their own answer
  quotedText: string; // the highlighted anchor text
  contextMd: string; // ancestor chain markdown (root chunk → … → parent)
  intent?: 'why' | 'respond'; // ask why, or submit an answer for feedback
  signal?: AbortSignal;
};

export type LessonChunkRequest = {
  sessionId: string;
  topic: string;
  previousChunksMd: string[]; // spine chunks so far, in seq order
  chunkIndex: number; // 0-based index of the chunk being requested
  signal?: AbortSignal;
};

// A lesson-chunk stream may end with this marker on its own final line,
// signaling the lesson is complete. Callers strip it from the node body.
export const LESSON_DONE_MARKER = 'LESSON_DONE';

// The one seam between the graph and the LLM. Swapping providers (mock,
// Gemini, Anthropic) never touches the store or UI.
export interface TeachService {
  streamAnswer(req: AnswerRequest): AsyncGenerator<string>; // yields markdown deltas
  streamLessonChunk(req: LessonChunkRequest): AsyncGenerator<string>; // yields markdown deltas
}
