// Vercel edge function: POST /api/claude → Anthropic Messages API, streamed.
// Set ANTHROPIC_API_KEY (and optionally ANTHROPIC_MODEL) in the Vercel project
// env. The key never reaches the browser.
//
// Self-contained on purpose: Vercel compiles each api/* file standalone with
// its own tsconfig (no allowImportingTsExtensions), so a relative import of a
// .ts module fails to build. npm packages are fine — but the proxy logic must
// mirror server/claude.ts (used by the Vite dev middleware); server/claude.test.ts
// asserts the two stay in sync.

import Anthropic from '@anthropic-ai/sdk';

export const config = { runtime: 'edge' };

const DEFAULT_CLAUDE_MODEL = 'claude-opus-5';

const CLAUDE_MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'];

// Generous because thinking tokens are billed against max_tokens: a cap sized
// for the prose alone is how a deliberating model returns an empty body.
const MAX_TOKENS = 32000;

type ClaudePayload = {
  system: string;
  user: string;
  model?: string;
  schema?: Record<string, unknown>;
  effort?: 'low' | 'medium' | 'high';
};

function isClaudePayload(v: unknown): v is ClaudePayload {
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

function sanitizeClaudeModel(model: string | undefined): string | null {
  return typeof model === 'string' && CLAUDE_MODELS.includes(model) ? model : null;
}

function sse(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

function statusOf(err: unknown): number {
  return err instanceof Anthropic.APIError && typeof err.status === 'number' ? err.status : 502;
}

function describe(err: unknown): string {
  if (err instanceof Anthropic.APIError) return `Anthropic API ${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

function errorBody(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return errorBody('ANTHROPIC_API_KEY is not configured', 503);
  }
  const payload: unknown = await req.json().catch(() => null);
  if (!isClaudePayload(payload)) {
    return errorBody('invalid payload', 400);
  }

  const client = new Anthropic({ apiKey });
  const model =
    sanitizeClaudeModel(payload.model) ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_CLAUDE_MODEL;

  const open = (withSchema: boolean) => {
    const outputConfig: Anthropic.OutputConfig = { effort: payload.effort ?? 'medium' };
    if (withSchema && payload.schema) {
      outputConfig.format = { type: 'json_schema', schema: payload.schema };
    }
    // No temperature / top_p / top_k / thinking.budget_tokens: these models
    // reject all four with a 400.
    return client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: payload.system,
      messages: [{ role: 'user', content: payload.user }],
      output_config: outputConfig,
      stream: true,
    });
  };

  let events;
  try {
    events = await open(Boolean(payload.schema));
  } catch (err) {
    // A schema the API won't accept fails the whole request; ask again plainly
    // rather than losing the learner's turn over an optional hint.
    if (payload.schema && err instanceof Anthropic.APIError && err.status === 400) {
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
        // The status line is long gone; the stream is the only honest channel left.
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
