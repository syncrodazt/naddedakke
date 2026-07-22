// Vercel edge function: POST /api/chat → Gemini streamGenerateContent (SSE).
// Set GEMINI_API_KEY (and optionally GEMINI_MODEL) in the Vercel project env.
import { DEFAULT_GEMINI_MODEL, isChatPayload, proxyChat } from '../server/gemini.ts';

export const config = { runtime: 'edge' };

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
  const upstream = await proxyChat(
    payload,
    apiKey,
    process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
  );
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'text/event-stream',
      'Cache-Control': 'no-store',
    },
  });
}
