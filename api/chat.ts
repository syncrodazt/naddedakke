// Vercel edge function: POST /api/chat → Gemini streamGenerateContent (SSE).
// Set GEMINI_API_KEY (and optionally GEMINI_MODEL) in the Vercel project env.
//
// Self-contained on purpose: Vercel compiles each api/* file standalone with
// its own tsconfig (no allowImportingTsExtensions), so a relative import of a
// .ts module fails to build. The proxy core is small — it mirrors
// server/gemini.ts (used by the Vite dev middleware); keep the two in sync.

export const config = { runtime: 'edge' };

// Rolling alias — always the current flash model (a pinned version like
// gemini-2.5-flash can 404 for new keys). Override via GEMINI_MODEL.
const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

type ChatPayload = {
  system: string;
  user: string;
  model?: string;
  json?: boolean;
  noThinking?: boolean;
  /**
   * Google Search grounding. Mutually exclusive with `json`: the API rejects
   * the pair with "controlled generation is not supported with google_search
   * tool", so search wins and the reply is parsed leniently instead.
   */
  search?: boolean;
};

// Thinking tokens are billed against maxOutputTokens, so a budget sized for the
// answer alone comes back EMPTY once the model deliberates — the text parts are
// simply absent. 2048 was low enough to hit that on a JSON request.
const MAX_OUTPUT_TOKENS = 8192;

function isChatPayload(v: unknown): v is ChatPayload {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.system === 'string' &&
    typeof o.user === 'string' &&
    (o.model === undefined || typeof o.model === 'string') &&
    (o.json === undefined || typeof o.json === 'boolean') &&
    (o.noThinking === undefined || typeof o.noThinking === 'boolean') &&
    (o.search === undefined || typeof o.search === 'boolean')
  );
}

// A client-supplied model id goes into the request URL path — allow only the
// character set real Gemini/Gemma ids use.
function sanitizeModel(model: string | undefined): string | null {
  if (typeof model !== 'string') return null;
  return /^[a-zA-Z0-9.-]{1,64}$/.test(model) ? model : null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY is not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const payload: unknown = await req.json().catch(() => null);
  if (!isChatPayload(payload)) {
    return new Response(JSON.stringify({ error: 'invalid payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const model = sanitizeModel(payload.model) ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const generationConfig = (withOptional: boolean): object => {
    const base: Record<string, unknown> = { maxOutputTokens: MAX_OUTPUT_TOKENS };
    if (!withOptional) return base;
    // Never both: the API refuses the combination outright.
    if (payload.json && !payload.search) base.responseMimeType = 'application/json';
    if (payload.noThinking) base.thinkingConfig = { thinkingBudget: 0 };
    return base;
  };

  const tools = (withOptional: boolean): object[] | undefined =>
    withOptional && payload.search ? [{ google_search: {} }] : undefined;

  const send = (withOptional: boolean): Promise<Response> =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: payload.system }] },
        contents: [{ role: 'user', parts: [{ text: payload.user }] }],
        generationConfig: generationConfig(withOptional),
        ...(tools(withOptional) ? { tools: tools(withOptional) } : {}),
      }),
    });

  const wantsOptional = Boolean(payload.json || payload.noThinking || payload.search);
  let upstream = await send(wantsOptional);
  // Models that don't understand responseMimeType/thinkingConfig/tools reject
  // the whole request; drop the optional hints and ask again plainly. The
  // client decides what to SHOW from whether grounding appears in the stream,
  // so a silent retry cannot pass an ungrounded answer off as a searched one.
  if (wantsOptional && upstream.status === 400) upstream = await send(false);

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'text/event-stream',
      'Cache-Control': 'no-store',
    },
  });
}
