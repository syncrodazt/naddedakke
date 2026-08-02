// Shared proxy core for the Anthropic Messages API — used by the Vite dev
// middleware (vite.config.ts). The Vercel edge function (api/claude.ts) inlines
// an equivalent because Vercel compiles each function standalone; keep the two
// in sync (server/claude.test.ts asserts they agree). The API key stays
// server-side: CLAUDE.md forbids shipping it to the browser.
//
// Raw HTTP rather than @anthropic-ai/sdk, deliberately. The SDK reaches for
// node:fs, node:child_process and node:readline, none of which exist in the
// Edge Runtime the production function runs on — importing it there failed the
// Vercel build outright. Using it in dev and fetch in production would mean the
// path that gets exercised is not the path that ships, which is how that broke
// unnoticed in the first place, so both sides speak HTTP.
//
// Wire format out of this proxy is deliberately NOT Anthropic's: it emits
//   data: {"text":"…"}      one text delta
//   data: {"error":"…"}     a failure that surfaced after the stream opened
// so the browser needs no knowledge of block indices or event types.

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

export type ClaudePayload = {
  system: string;
  user: string;
  model?: string;
  /** JSON Schema for a structured reply (Anthropic `output_config.format`). */
  schema?: Record<string, unknown>;
  /**
   * Reasoning effort. Thinking is on by default on Opus 5 and cannot be turned
   * off at every effort level, so effort — not a thinking budget — is the lever
   * we expose. `budget_tokens` is rejected outright by these models.
   */
  effort?: 'low' | 'medium' | 'high';
  /**
   * Let the model search the web before answering.
   *
   * `web_search_20250305` — the basic tool — rather than a newer version on
   * purpose: the later ones run search inside code execution by default, which
   * Haiku 4.5 does not support, and this app offers Haiku. One tool definition
   * that works on every model we list beats three that need per-model handling.
   */
  search?: boolean;
};

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5';

// Curated rather than fetched: unlike Gemini there is no per-key model list to
// discover, and the Messages API accepts ids this app has no use for.
export const CLAUDE_MODELS: { id: string; label: string; provider: 'claude' }[] = [
  { id: 'claude-opus-5', label: 'Claude Opus 5', provider: 'claude' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', provider: 'claude' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'claude' },
];

/** Which provider a model id belongs to — the client routes on this too. */
export function isClaudeModel(id: string | undefined): boolean {
  return typeof id === 'string' && id.startsWith('claude-');
}

// Generous because thinking tokens are billed against max_tokens: a cap sized
// for the prose alone is how a deliberating model returns an empty body. It is
// a ceiling, not an allocation — nothing is spent by raising it.
const MAX_TOKENS = 32000;

const WEB_SEARCH_TOOL = 'web_search_20250305';
const MAX_SEARCHES = 5;

export function isClaudePayload(v: unknown): v is ClaudePayload {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.system === 'string' &&
    typeof o.user === 'string' &&
    (o.model === undefined || typeof o.model === 'string') &&
    (o.schema === undefined || (typeof o.schema === 'object' && o.schema !== null)) &&
    (o.effort === undefined ||
      o.effort === 'low' ||
      o.effort === 'medium' ||
      o.effort === 'high') &&
    (o.search === undefined || typeof o.search === 'boolean')
  );
}

/** Only ids this app offers — a client-supplied string never reaches the API raw. */
export function sanitizeClaudeModel(model: string | undefined): string | null {
  return CLAUDE_MODELS.some((m) => m.id === model) ? (model as string) : null;
}

export function buildRequestBody(
  payload: ClaudePayload,
  model: string,
  withSchema: boolean,
): Record<string, unknown> {
  const outputConfig: Record<string, unknown> = { effort: payload.effort ?? 'medium' };
  if (withSchema && payload.schema) {
    outputConfig.format = { type: 'json_schema', schema: payload.schema };
  }
  const body: Record<string, unknown> = {
    model,
    max_tokens: MAX_TOKENS,
    system: payload.system,
    messages: [{ role: 'user', content: payload.user }],
    output_config: outputConfig,
    stream: true,
  };
  // Capped: this app searches to find a handful of sources for one passage, and
  // an uncapped tool on a vague prompt can run ten searches for the same thing.
  if (payload.search) {
    body.tools = [{ type: WEB_SEARCH_TOOL, name: 'web_search', max_uses: MAX_SEARCHES }];
  }
  return body;
  // No temperature / top_p / top_k / thinking.budget_tokens: these models
  // reject all four with a 400.
}

/**
 * Rewrite Anthropic's SSE into this proxy's `{text}` / `{error}` shape.
 *
 * Only text deltas are forwarded — thinking deltas are the model's scratchpad,
 * not the lesson, and must never land in a node's body.
 */
export function transformSse(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';

  const emit = (controller: TransformStreamDefaultController<Uint8Array>, obj: unknown): void => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
  };

  const handleLine = (
    line: string,
    controller: TransformStreamDefaultController<Uint8Array>,
  ): void => {
    if (!line.startsWith('data:')) return; // `event:` lines are redundant here
    const raw = line.slice(5).trim();
    if (raw === '' || raw === '[DONE]') return;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const evt = data as {
      type?: string;
      delta?: { type?: string; text?: string };
      error?: { message?: string; type?: string };
    };
    if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
      emit(controller, { text: evt.delta.text ?? '' });
    } else if (evt.type === 'error') {
      // The status line is long gone; the stream is the only honest channel left.
      emit(controller, { error: evt.error?.message ?? evt.error?.type ?? 'stream error' });
    }
  };

  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) handleLine(line.trim(), controller);
    },
    flush(controller) {
      if (buffer.trim() !== '') handleLine(buffer.trim(), controller);
    },
  });
}

function errorBody(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Run one Messages request and return an SSE Response of text deltas.
 *
 * The upstream call is awaited before responding so an auth or quota failure
 * comes back as a real HTTP status the client can report, rather than as a
 * 200 that streams nothing.
 */
export async function proxyClaude(
  payload: ClaudePayload,
  apiKey: string,
  fallbackModel: string = DEFAULT_CLAUDE_MODEL,
): Promise<Response> {
  const model = sanitizeClaudeModel(payload.model) ?? fallbackModel;

  const send = (withSchema: boolean): Promise<Response> =>
    fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify(buildRequestBody(payload, model, withSchema)),
    });

  let upstream = await send(Boolean(payload.schema));
  // A schema the API won't accept fails the whole request. Rather than losing
  // the learner's turn over an optional hint, ask again without it — the reply
  // is still validated (and rejected if malformed) on the client.
  if (payload.schema && upstream.status === 400) upstream = await send(false);

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    return errorBody(`Anthropic API ${upstream.status}: ${detail.slice(0, 300)}`, upstream.status);
  }

  return new Response(upstream.body.pipeThrough(transformSse()), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' },
  });
}
