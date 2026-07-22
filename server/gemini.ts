// Shared proxy core for the Gemini API — used by the Vite dev middleware
// (vite.config.ts). The Vercel edge functions (api/chat.ts, api/models.ts)
// inline equivalents because Vercel compiles each function standalone; keep
// the three in sync. The API key stays server-side.

export type ChatPayload = { system: string; user: string; model?: string };

// Rolling alias — always the current flash model (a pinned version like
// gemini-2.5-flash can 404 for new keys). Override via GEMINI_MODEL.
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

export function isChatPayload(v: unknown): v is ChatPayload {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.system === 'string' &&
    typeof o.user === 'string' &&
    (o.model === undefined || typeof o.model === 'string')
  );
}

// A client-supplied model id goes straight into the request URL path, so allow
// only the character set real Gemini/Gemma ids use.
export function sanitizeModel(model: string | undefined): string | null {
  if (typeof model !== 'string') return null;
  return /^[a-zA-Z0-9.-]{1,64}$/.test(model) ? model : null;
}

export async function listModels(apiKey: string): Promise<{ id: string; label: string }[]> {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
    headers: { 'x-goog-api-key': apiKey },
  });
  if (!res.ok) return [];
  const data: unknown = await res.json();
  const exclude = /image|tts|embedding|vision|aqa|nano-banana|audio|native-audio|live/i;
  const raw =
    (data as { models?: { name?: string; supportedGenerationMethods?: string[] }[] }).models ?? [];
  return raw
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => (m.name ?? '').replace(/^models\//, ''))
    .filter(
      (id) => id !== '' && (id.startsWith('gemini') || id.startsWith('gemma')) && !exclude.test(id),
    )
    .map((id) => ({ id, label: id }));
}

export async function proxyChat(
  payload: ChatPayload,
  apiKey: string,
  fallbackModel: string = DEFAULT_GEMINI_MODEL,
): Promise<Response> {
  const model = sanitizeModel(payload.model) ?? fallbackModel;
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
