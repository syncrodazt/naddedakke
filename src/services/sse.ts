// Minimal SSE reader for the proxy streams. The framing is the same for every
// provider; only the per-event payload shape differs, so the extractor is a
// parameter: `extractGeminiText` for /api/chat, `extractClaudeText` for
// /api/claude.

/** Pull the text delta out of one parsed SSE payload; '' when there is none. */
export type DeltaExtractor = (data: unknown) => string;

/** Extract the text delta from one parsed Gemini stream chunk, if any. */
export function extractGeminiText(data: unknown): string {
  if (typeof data !== 'object' || data === null) return '';
  const candidates = (data as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return '';
  const content = (candidates[0] as { content?: { parts?: unknown } }).content;
  if (!content || !Array.isArray(content.parts)) return '';
  return content.parts
    .map((p) =>
      typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : '',
    )
    .join('');
}

/**
 * Text delta out of one /api/claude event — our own `{text}` / `{error}` shape,
 * not Anthropic's. An error only reaches the stream when it surfaced after the
 * status line was already sent, so raising it here is the only way it is seen.
 */
export function extractClaudeText(data: unknown): string {
  if (typeof data !== 'object' || data === null) return '';
  const o = data as { text?: unknown; error?: unknown };
  if (typeof o.error === 'string') throw new Error(o.error);
  return typeof o.text === 'string' ? o.text : '';
}

/** Parse one SSE line; returns the JSON payload of a data line, else null. */
export function parseSseDataLine(line: string): unknown | null {
  if (!line.startsWith('data:')) return null;
  const raw = line.slice(5).trim();
  if (raw === '' || raw === '[DONE]') return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Async-iterate text deltas out of an SSE byte stream. */
export async function* streamSseText(
  body: ReadableStream<Uint8Array>,
  extract: DeltaExtractor = extractGeminiText,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const data = parseSseDataLine(line.trim());
        if (data !== null) {
          const text = extract(data);
          if (text !== '') yield text;
        }
      }
    }
    const data = parseSseDataLine(buffer.trim());
    if (data !== null) {
      const text = extract(data);
      if (text !== '') yield text;
    }
  } finally {
    reader.releaseLock();
  }
}
