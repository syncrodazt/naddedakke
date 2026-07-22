// Shared proxy core for the Gemini API — used by both the Vite dev middleware
// (vite.config.ts) and the Vercel edge function (api/chat.ts). The API key
// stays server-side; the browser only ever talks to /api/chat.
//
// Wire format verified against the Gemini REST docs (streamGenerateContent
// with alt=sse; deltas arrive in candidates[0].content.parts[].text).

export type ChatPayload = { system: string; user: string };

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

export function isChatPayload(v: unknown): v is ChatPayload {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>).system === 'string' &&
    typeof (v as Record<string, unknown>).user === 'string'
  );
}

export async function proxyChat(
  payload: ChatPayload,
  apiKey: string,
  model: string = DEFAULT_GEMINI_MODEL,
): Promise<Response> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: payload.system }] },
      contents: [{ role: 'user', parts: [{ text: payload.user }] }],
      generationConfig: { maxOutputTokens: 2048 },
    }),
  });
}
