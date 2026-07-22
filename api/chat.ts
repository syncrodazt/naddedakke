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

type ChatPayload = { system: string; user: string };

function isChatPayload(v: unknown): v is ChatPayload {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>).system === 'string' &&
    typeof (v as Record<string, unknown>).user === 'string'
  );
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

  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const upstream = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: payload.system }] },
      contents: [{ role: 'user', parts: [{ text: payload.user }] }],
      generationConfig: { maxOutputTokens: 2048 },
    }),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'text/event-stream',
      'Cache-Control': 'no-store',
    },
  });
}
