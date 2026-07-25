// Shared proxy core for the Gemini API — used by the Vite dev middleware
// (vite.config.ts). The Vercel edge functions (api/chat.ts, api/models.ts)
// inline equivalents because Vercel compiles each function standalone; keep
// the three in sync. The API key stays server-side.

export type ChatPayload = {
  system: string;
  user: string;
  model?: string;
  /** Ask for a raw JSON body (structured output) rather than prose. */
  json?: boolean;
  /** Turn model "thinking" off — deterministic structure beats deliberation. */
  noThinking?: boolean;
};

// Thinking tokens are billed against maxOutputTokens, so a budget sized for the
// answer alone comes back EMPTY once the model decides to deliberate — the text
// parts are simply absent. 2048 was low enough to hit that on a JSON request.
const MAX_OUTPUT_TOKENS = 8192;

// Rolling alias — always the current flash model (a pinned version like
// gemini-2.5-flash can 404 for new keys). Override via GEMINI_MODEL.
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

export function isChatPayload(v: unknown): v is ChatPayload {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.system === 'string' &&
    typeof o.user === 'string' &&
    (o.model === undefined || typeof o.model === 'string') &&
    (o.json === undefined || typeof o.json === 'boolean') &&
    (o.noThinking === undefined || typeof o.noThinking === 'boolean')
  );
}

/**
 * generationConfig for a request. `responseMimeType` and `thinkingConfig` are
 * not understood by every model we let the user pick (Gemma, older Gemini), so
 * they are kept separable — see the retry in proxyChat.
 */
export function buildGenerationConfig(payload: ChatPayload, withOptional: boolean): object {
  const base: Record<string, unknown> = { maxOutputTokens: MAX_OUTPUT_TOKENS };
  if (!withOptional) return base;
  if (payload.json) base.responseMimeType = 'application/json';
  if (payload.noThinking) base.thinkingConfig = { thinkingBudget: 0 };
  return base;
}

// A client-supplied model id goes straight into the request URL path, so allow
// only the character set real Gemini/Gemma ids use.
export function sanitizeModel(model: string | undefined): string | null {
  if (typeof model !== 'string') return null;
  return /^[a-zA-Z0-9.-]{1,64}$/.test(model) ? model : null;
}

export type ModelOption = { id: string; label: string; provider: 'gemini' | 'claude' };

export async function listModels(apiKey: string): Promise<ModelOption[]> {
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
    .map((id) => ({ id, label: id, provider: 'gemini' as const }));
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

  const send = (withOptional: boolean): Promise<Response> =>
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: payload.system }] },
        contents: [{ role: 'user', parts: [{ text: payload.user }] }],
        generationConfig: buildGenerationConfig(payload, withOptional),
      }),
    });

  const wantsOptional = Boolean(payload.json || payload.noThinking);
  const first = await send(wantsOptional);
  // A model that doesn't understand responseMimeType/thinkingConfig rejects the
  // whole request. Rather than failing the user's turn over an optional hint,
  // drop the hints and ask again plainly.
  if (wantsOptional && first.status === 400) return send(false);
  return first;
}
