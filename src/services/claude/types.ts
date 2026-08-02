export type AnswerRequest = {
  sessionId: string;
  question: string; // the learner's text — a "why?" question, or their own answer
  quotedText: string; // the highlighted anchor text
  contextMd: string; // ancestor chain markdown (root chunk → … → parent)
  intent?: 'why' | 'respond'; // ask why, or submit an answer for feedback
  signal?: AbortSignal;
};

export type LessonPlanRequest = {
  topic: string; // what the learner asked to understand, in their own words
  langLabel: string; // the learner's language, in its own name
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
  // The plan this lesson was promised against, and which step is being written.
  // Passed so the chunk that arrives is the step the learner was shown, rather
  // than whatever the model would have chosen next on its own.
  plan?: { steps: { title: string; gist: string }[]; stepIndex: number };
  signal?: AbortSignal;
};

export type GoalPlanRequest = {
  goal: string; // the learner's goal, in their own words
  // Set when decomposing ONE node inside a graph that already exists: these
  // quantities may be referenced by the new formulas but must not be redefined.
  existingNames?: string[];
  signal?: AbortSignal;
};

/** One node to translate: its body plus every quote that must survive in it. */
export type TranslateItem = {
  id: string;
  md: string;
  // The highlighted passages anchored in this node. They come back translated
  // too, so a branch stays attached to the sentence that provoked it.
  quotes: { id: string; text: string }[];
};

export type TranslateRequest = {
  targetLang: string; // language code, e.g. 'ja' | 'th' | 'en'
  targetLabel: string; // the language's own name, so the model can't misread the code
  items: TranslateItem[];
  signal?: AbortSignal;
};

export type ConceptMapRequest = {
  /** What the learner already has: one entry per notebook, titles + headings. */
  inventory: { id: string; title: string; headings: string[] }[];
  /** How many NEW concepts to propose beyond what the notebooks already cover. */
  want: number;
  /** The learner's language, so names and blurbs come back readable. */
  langLabel: string;
  signal?: AbortSignal;
};

// The one seam between the graph and the LLM. Swapping providers (mock,
// Gemini, Anthropic) never touches the store or UI.
export interface TeachService {
  // The whole lesson's plan, before any of it is taught. One document,
  // resolving whole: a half-written plan cannot be shown as a promise.
  planLesson(req: LessonPlanRequest): Promise<string>;
  streamAnswer(req: AnswerRequest): AsyncGenerator<string>; // yields markdown deltas
  // Yields deltas of a JSON lesson-chunk object; LessonStreamParser turns those
  // into live markdown. A provider that replies with plain markdown instead is
  // handled by the same parser.
  streamLessonChunk(req: LessonChunkRequest): AsyncGenerator<string>;
  // Back-cast decomposition returns one JSON document, so it resolves whole
  // rather than streaming — a half-parsed plan is of no use to anyone.
  decomposeGoal(req: GoalPlanRequest): Promise<string>;
  // Many nodes per call, resolving whole: translations are applied a batch at a
  // time and a half-translated body has nowhere to go.
  translate(req: TranslateRequest): Promise<string>;
  // A proposed map of what to learn next. One document, reviewed before it is
  // shown as a recommendation — same as a back-cast plan.
  suggestConcepts(req: ConceptMapRequest): Promise<string>;
}
