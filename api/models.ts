// Vercel edge function: GET /api/models → the models this deployment's keys can
// reach, tagged by provider so the picker can group them. Self-contained (see
// api/chat.ts for why).

export const config = { runtime: 'edge' };

type GeminiModel = { name?: string; displayName?: string; supportedGenerationMethods?: string[] };
type ModelOption = { id: string; label: string; provider: 'gemini' | 'claude' };

// Drop non-text variants — image/tts/embedding/vision models can't stream a lesson.
const EXCLUDE = /image|tts|embedding|vision|aqa|nano-banana|audio|native-audio|live/i;

// Curated: unlike Gemini there is no per-key list to discover, and the Messages
// API accepts ids this app has no use for. Mirrors server/claude.ts.
const CLAUDE_MODELS: ModelOption[] = [
  { id: 'claude-opus-5', label: 'Claude Opus 5', provider: 'claude' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', provider: 'claude' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'claude' },
];

async function geminiModels(apiKey: string): Promise<ModelOption[]> {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
    headers: { 'x-goog-api-key': apiKey },
  });
  if (!res.ok) return [];
  const data: unknown = await res.json();
  const raw = (data as { models?: GeminiModel[] }).models ?? [];
  return raw
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => (m.name ?? '').replace(/^models\//, ''))
    .filter(
      (id) => id !== '' && (id.startsWith('gemini') || id.startsWith('gemma')) && !EXCLUDE.test(id),
    )
    .map((id) => ({ id, label: id, provider: 'gemini' as const }));
}

export default async function handler(): Promise<Response> {
  const models: ModelOption[] = [];
  // Claude first: it is the better provider, so it leads the picker.
  if (process.env.ANTHROPIC_API_KEY) models.push(...CLAUDE_MODELS);
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    models.push(...(await geminiModels(geminiKey).catch(() => [])));
  }

  return new Response(JSON.stringify({ models }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
  });
}
