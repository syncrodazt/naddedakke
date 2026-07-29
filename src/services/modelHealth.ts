// Which models the provider actually accepts.
//
// Gemini's ListModels endpoint reports models that then fail on use: asking
// gemini-2.5-flash to generate returns
//
//   404 … "is no longer available to new users. Please update your code to use
//   a newer model."
//
// So a picker built from the list alone offers choices that are guaranteed to
// break, and the learner only finds out by losing a question to it.
//
// The list cannot be pre-filtered honestly — nothing in it marks these — so the
// app learns from the real failure instead: the first refusal removes the model
// from the picker for good and the request is retried on one that works.

/**
 * Whether a proxy failure means "this model is not usable", as opposed to a
 * transient one (rate limit, network, server error) that must NOT disqualify a
 * model the learner picked.
 */
export function isModelUnavailable(status: number, body: string): boolean {
  if (status !== 404 && status !== 400) return false;
  const text = body.toLowerCase();
  return (
    text.includes('no longer available') ||
    text.includes('is not found') ||
    text.includes('not found for api version') ||
    text.includes('is not supported') ||
    (text.includes('models/') && text.includes('not found'))
  );
}
