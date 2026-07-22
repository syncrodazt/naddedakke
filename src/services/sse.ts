// Minimal SSE reader for the /api/chat proxy stream (Gemini alt=sse format).

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
export async function* streamSseText(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
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
          const text = extractGeminiText(data);
          if (text !== '') yield text;
        }
      }
    }
    const data = parseSseDataLine(buffer.trim());
    if (data !== null) {
      const text = extractGeminiText(data);
      if (text !== '') yield text;
    }
  } finally {
    reader.releaseLock();
  }
}
