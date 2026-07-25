// Falls back to a secondary stream if the primary fails before yielding
// anything (proxy missing, no API key, network down). Errors after the first
// token are real mid-stream failures and are rethrown.
//
// An aborted request is never a fallback: the learner asked to stop, and
// answering them with canned mock text instead would be worse than stopping.
// `onFallback` exists so the UI can say out loud that the answer is not the
// model's — a silent swap is indistinguishable from a real reply.
export async function* withFallback(
  primary: AsyncGenerator<string>,
  fallback: () => AsyncGenerator<string>,
  onFallback?: (err: unknown) => void,
): AsyncGenerator<string> {
  let yielded = false;
  try {
    for await (const delta of primary) {
      yielded = true;
      yield delta;
    }
  } catch (err) {
    if (yielded) throw err;
    if (err instanceof Error && err.name === 'AbortError') throw err;
    console.warn('LLM service unavailable, falling back to mock:', err);
    onFallback?.(err);
    yield* fallback();
  }
}
