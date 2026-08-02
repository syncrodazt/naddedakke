// Did the model actually look anything up?
//
// This is the question the "unverified" badge answers, so it must be read off
// the stream rather than inferred from what we asked for. Asking for search is
// not the same as searching: a model may decide it already knows, the proxy may
// silently retry without the tool for a model that cannot use it, and either
// way the links that come back are memory. Getting this wrong in the optimistic
// direction is the worst failure available here — it puts the appearance of
// evidence on something that has none.

/**
 * Gemini: grounding metadata rides along on the candidate in the same stream
 * chunks the text comes from, so the client can see it directly.
 */
export function sawGeminiGrounding(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false;
  const candidates = (data as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return false;
  return candidates.some((c) => {
    const meta = (c as { groundingMetadata?: unknown }).groundingMetadata;
    if (typeof meta !== 'object' || meta === null) return false;
    const chunks = (meta as { groundingChunks?: unknown }).groundingChunks;
    const queries = (meta as { webSearchQueries?: unknown }).webSearchQueries;
    // Either is proof a search ran. An empty groundingMetadata object is not.
    return (
      (Array.isArray(chunks) && chunks.length > 0) || (Array.isArray(queries) && queries.length > 0)
    );
  });
}

/**
 * Claude: our proxy rewrites Anthropic's SSE, so it flags a search itself when
 * it sees a `server_tool_use` block go by. `{searched:true}` is that flag.
 */
export function sawClaudeSearch(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false;
  return (data as { searched?: unknown }).searched === true;
}
