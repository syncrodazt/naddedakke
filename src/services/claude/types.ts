export type AnswerRequest = {
  sessionId: string;
  question: string; // the user's question text
  quotedText: string; // the highlighted anchor text
  contextMd: string; // ancestor chain markdown (root chunk → … → parent), for the real API
  signal?: AbortSignal;
};

// The one seam between the graph and the LLM. Milestone 4 swaps the mock for
// a streaming Anthropic Messages API client behind the same interface.
export interface TeachService {
  streamAnswer(req: AnswerRequest): AsyncGenerator<string>; // yields markdown deltas
}
