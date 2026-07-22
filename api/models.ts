// Vercel edge function: GET /api/models → the text-generation Gemini models
// this key can reach. Self-contained (see api/chat.ts for why).

export const config = { runtime: 'edge' };

type GeminiModel = { name?: string; displayName?: string; supportedGenerationMethods?: string[] };

// Drop non-text variants — image/tts/embedding/vision models can't stream a lesson.
const EXCLUDE = /image|tts|embedding|vision|aqa|nano-banana|audio|native-audio|live/i;

export default async function handler(): Promise<Response> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ models: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
    headers: { 'x-goog-api-key': apiKey },
  });
  if (!res.ok) {
    return new Response(JSON.stringify({ models: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const data: unknown = await res.json();
  const raw = (data as { models?: GeminiModel[] }).models ?? [];
  const models = raw
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => (m.name ?? '').replace(/^models\//, ''))
    .filter(
      (id) => id !== '' && (id.startsWith('gemini') || id.startsWith('gemma')) && !EXCLUDE.test(id),
    )
    .map((id) => ({ id, label: id }));

  return new Response(JSON.stringify({ models }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
  });
}
