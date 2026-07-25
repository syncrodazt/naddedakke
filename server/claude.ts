// Shared proxy core for the Anthropic Messages API — used by the Vite dev
// middleware (vite.config.ts). The Vercel edge function (api/claude.ts) inlines
// an equivalent because Vercel compiles each function standalone; keep the two
// in sync (server/claude.test.ts asserts they agree). The API key stays
// server-side: CLAUDE.md forbids shipping it to the browser.
//
// Wire format out of this proxy is deliberately NOT Anthropic's: it emits
//   data: {"text":"…"}      one text delta
//   data: {"error":"…"}     a failure that surfaced after the stream opened
// so the browser needs no Anthropic SDK and no knowledge of block indices.

import Anthropic from '@anthropic-ai/sdk';

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

export function isClaudePayload(v: unknown): v is ClaudePayload {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.system === 'string' &&
    typeof o.user === 'string' &&
    (o.model === undefined || typeof o.model === 'string') &&
    (o.schema === undefined || (typeof o.schema === 'object' && o.schema !== null)) &&
    (o.effort === undefined || o.effort === 'low' || o.effort === 'medium' || o.effort === 'high')
  );
}

/** Only ids this app offers — a client-supplied string never reaches the API raw. */
export function sanitizeClaudeModel(model: string | undefined): string | null {
  return CLAUDE_MODELS.some((m) => m.id === model) ? (model as string) : null;
}

export function buildMessageParams(
  payload: ClaudePayload,
  model: string,
  withSchema: boolean,
): Anthropic.MessageCreateParamsStreaming {
  const outputConfig: Anthropic.OutputConfig = { effort: payload.effort ?? 'medium' };
  if (withSchema && payload.schema) {
    outputConfig.format = { type: 'json_schema', schema: payload.schema };
  }
  return {
    model,
    max_tokens: MAX_TOKENS,
    system: payload.system,
    messages: [{ role: 'user', content: payload.user }],
    output_config: outputConfig,
    stream: true,
  };
  // No temperature / top_p / top_k / thinking.budget_tokens: these models
  // reject all four with a 400.
}

function sse(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
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
  const client = new Anthropic({ apiKey });
  const model = sanitizeClaudeModel(payload.model) ?? fallbackModel;

  const open = async (withSchema: boolean) =>
    client.messages.create(buildMessageParams(payload, model, withSchema));

  let events;
  try {
    events = await open(Boolean(payload.schema));
  } catch (err) {
    // A schema the API won't accept fails the whole request. Rather than losing
    // the learner's turn over an optional hint, ask again without it — the
    // reply is still validated (and rejected if malformed) on the client.
    const status = err instanceof Anthropic.APIError ? err.status : undefined;
    if (payload.schema && status === 400) {
      try {
        events = await open(false);
      } catch (retryErr) {
        return errorBody(describe(retryErr), statusOf(retryErr));
      }
    } else {
      return errorBody(describe(err), statusOf(err));
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of events) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            controller.enqueue(sse({ text: event.delta.text }));
          }
        }
      } catch (err) {
        // The status line is long gone; the only honest channel left is the
        // stream itself. The client turns this into a thrown error.
        controller.enqueue(sse({ error: describe(err) }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' },
  });
}

function statusOf(err: unknown): number {
  return err instanceof Anthropic.APIError && typeof err.status === 'number' ? err.status : 502;
}

function describe(err: unknown): string {
  if (err instanceof Anthropic.APIError) return `Anthropic API ${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
