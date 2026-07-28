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
  // Set when the learner asked what they need to understand BEFORE a chunk:
  // the markdown of the chunk that lost them. The reply is still one lesson
  // chunk, so the same stream parser and node handling apply.
  prerequisiteFor?: string;
  signal?: AbortSignal;
};

export type GoalPlanRequest = {
  goal: string; // the learner's goal, in their own words
  // Set when decomposing ONE node inside a graph that already exists: these
  // quantities may be referenced by the new formulas but must not be redefined.
  existingNames?: string[];
  signal?: AbortSignal;
};

// The one seam between the graph and the LLM. Swapping providers (mock,
// Gemini, Anthropic) never touches the store or UI.
export interface TeachService {
  streamAnswer(req: AnswerRequest): AsyncGenerator<string>; // yields markdown deltas
  // Yields deltas of a JSON lesson-chunk object; LessonStreamParser turns those
  // into live markdown. A provider that replies with plain markdown instead is
  // handled by the same parser.
  streamLessonChunk(req: LessonChunkRequest): AsyncGenerator<string>;
  // Back-cast decomposition returns one JSON document, so it resolves whole
  // rather than streaming — a half-parsed plan is of no use to anyone.
  decomposeGoal(req: GoalPlanRequest): Promise<string>;
}
