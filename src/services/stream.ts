// Falls back to a secondary stream if the primary fails before yielding
// anything (proxy missing, no API key, network down). Errors after the first
// token are real mid-stream failures and are rethrown.
export async function* withFallback(
  primary: AsyncGenerator<string>,
  fallback: () => AsyncGenerator<string>,
): AsyncGenerator<string> {
  let yielded = false;
  try {
    for await (const delta of primary) {
      yielded = true;
      yield delta;
    }
  } catch (err) {
    if (yielded) throw err;
    console.warn('LLM service unavailable, falling back to mock:', err);
    yield* fallback();
  }
}
