import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_MODELS,
  buildRequestBody,
  isClaudeModel,
  isClaudePayload,
  sanitizeClaudeModel,
  transformSse,
} from './claude.ts';

const base = { system: 's', user: 'u' };

describe('claude proxy payload guards', () => {
  it('accepts a well-formed payload with the optional fields', () => {
    expect(isClaudePayload(base)).toBe(true);
    expect(isClaudePayload({ ...base, model: 'claude-opus-5' })).toBe(true);
    expect(isClaudePayload({ ...base, schema: { type: 'object' }, effort: 'high' })).toBe(true);
    expect(isClaudePayload({ system: 's' })).toBe(false);
    expect(isClaudePayload(null)).toBe(false);
  });

  it('accepts the search flag, and only as a boolean', () => {
    expect(isClaudePayload({ ...base, search: true })).toBe(true);
    expect(isClaudePayload({ ...base, search: 'yes' })).toBe(false);
  });

  it('asks for the web search tool only when the caller wants it', () => {
    const plain = buildRequestBody(base, 'claude-opus-5', false);
    expect(plain.tools).toBeUndefined();

    const searching = buildRequestBody({ ...base, search: true }, 'claude-opus-5', false);
    const tools = searching.tools as { type: string; name: string; max_uses: number }[];
    expect(tools).toHaveLength(1);
    // The basic tool, not a dynamic-filtering one: the later versions run
    // search inside code execution by default, which Haiku 4.5 cannot do.
    expect(tools[0]!.type).toBe('web_search_20250305');
    expect(tools[0]!.name).toBe('web_search');
    // Capped, or a vague prompt runs ten searches for one passage.
    expect(tools[0]!.max_uses).toBeGreaterThan(0);
  });

  it('rejects fields of the wrong type or an unknown effort level', () => {
    expect(isClaudePayload({ ...base, model: 5 })).toBe(false);
    expect(isClaudePayload({ ...base, schema: 'object' })).toBe(false);
    // 'max' is a real API level but not one this app offers.
    expect(isClaudePayload({ ...base, effort: 'max' })).toBe(false);
  });

  it('allows only model ids this app offers', () => {
    expect(sanitizeClaudeModel('claude-opus-5')).toBe('claude-opus-5');
    expect(sanitizeClaudeModel('claude-haiku-4-5')).toBe('claude-haiku-4-5');
    // A plausible-looking id we never listed must not be forwarded.
    expect(sanitizeClaudeModel('claude-opus-5-20260101')).toBeNull();
    expect(sanitizeClaudeModel('gemini-flash-latest')).toBeNull();
    expect(sanitizeClaudeModel(undefined)).toBeNull();
  });

  it('routes by id prefix, matching the client-side router', () => {
    for (const m of CLAUDE_MODELS) expect(isClaudeModel(m.id)).toBe(true);
    expect(isClaudeModel('gemini-flash-latest')).toBe(false);
    expect(isClaudeModel(undefined)).toBe(false);
  });
});

describe('buildRequestBody', () => {
  it('never sends parameters these models reject', () => {
    // temperature / top_p / top_k / thinking.budget_tokens are 400s on Opus 5.
    const body = buildRequestBody({ ...base, schema: { type: 'object' } }, 'claude-opus-5', true);
    for (const banned of ['temperature', 'top_p', 'top_k', 'thinking']) {
      expect(body).not.toHaveProperty(banned);
    }
  });

  it('leaves room for thinking in the token budget', () => {
    // Thinking is on by default and is billed against max_tokens; a budget
    // sized for the prose alone is how a deliberating model returns nothing.
    expect(buildRequestBody(base, 'claude-opus-5', false).max_tokens).toBeGreaterThanOrEqual(16000);
  });

  it('attaches the schema only when asked, and defaults effort to medium', () => {
    const schema = { type: 'object' };
    expect(buildRequestBody({ ...base, schema }, 'claude-opus-5', true).output_config).toEqual({
      effort: 'medium',
      format: { type: 'json_schema', schema },
    });
    // The 400 retry drops the schema but must keep everything else.
    expect(buildRequestBody({ ...base, schema }, 'claude-opus-5', false).output_config).toEqual({
      effort: 'medium',
    });
    expect(
      buildRequestBody({ ...base, effort: 'high' }, 'claude-opus-5', true).output_config,
    ).toEqual({ effort: 'high' });
  });

  it('puts the prompt in the system field, not the user turn', () => {
    const body = buildRequestBody(base, 'claude-opus-5', false);
    expect(body.system).toBe('s');
    expect(body.messages).toEqual([{ role: 'user', content: 'u' }]);
    expect(body.stream).toBe(true);
  });
});

describe('transformSse', () => {
  async function through(sse: string): Promise<string[]> {
    const encoder = new TextEncoder();
    const source = new ReadableStream<Uint8Array>({
      start(c) {
        // One byte at a time: events must survive arbitrary chunk boundaries.
        for (const ch of sse) c.enqueue(encoder.encode(ch));
        c.close();
      },
    });
    const out: string[] = [];
    const reader = source.pipeThrough(transformSse()).getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.push(decoder.decode(value));
    }
    return out;
  }

  const delta = (text: string) =>
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    })}\n\n`;

  it('forwards text deltas in the shape the browser parses', async () => {
    const out = await through(delta('こん') + delta('にちは'));
    expect(out.join('')).toBe('data: {"text":"こん"}\n\ndata: {"text":"にちは"}\n\n');
  });

  it('drops the events that are not lesson text', async () => {
    // Thinking is the model's scratchpad; message_start/stop are bookkeeping.
    // Any of them reaching a node body would be visible nonsense.
    const thinking = `data: ${JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'thinking_delta', thinking: 'hmm' },
    })}\n\n`;
    const out = await through(
      'event: message_start\ndata: {"type":"message_start"}\n\n' +
        thinking +
        delta('real') +
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    );
    expect(out.join('')).toBe('data: {"text":"real"}\n\n');
  });

  it('surfaces an error that arrived after the stream opened', async () => {
    const out = await through(
      delta('partial') +
        `event: error\ndata: ${JSON.stringify({
          type: 'error',
          error: { type: 'overloaded_error', message: 'Overloaded' },
        })}\n\n`,
    );
    expect(out.join('')).toContain('{"error":"Overloaded"}');
  });

  it('ignores malformed data lines rather than failing the stream', async () => {
    const out = await through('data: not-json\n\n' + delta('ok'));
    expect(out.join('')).toBe('data: {"text":"ok"}\n\n');
  });
});

// The Vercel edge function inlines this proxy because Vercel compiles each
// api/* file standalone. Two copies drift; these are the parts that must not.
describe('api/claude.ts stays in sync with the proxy core', () => {
  const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');
  const edge = read('api/claude.ts');
  const core = read('server/claude.ts');

  it('uses the same token budget and default model', () => {
    const tokens = (src: string) => /MAX_TOKENS = (\d+)/.exec(src)?.[1];
    expect(tokens(edge)).toBe(tokens(core));
    const model = (src: string) => /DEFAULT_CLAUDE_MODEL = '([^']+)'/.exec(src)?.[1];
    expect(model(edge)).toBe(model(core));
  });

  it('offers the same model ids', () => {
    for (const m of CLAUDE_MODELS) expect(edge, `edge missing ${m.id}`).toContain(m.id);
  });

  it('both offer the same web search tool', () => {
    const tool = (src: string) => /WEB_SEARCH_TOOL = '([^']+)'/.exec(src)?.[1];
    expect(tool(edge)).toBe(tool(core));
    expect(tool(core)).toBe('web_search_20250305');
  });

  it('both retry without the schema on a 400', () => {
    expect(edge).toContain('status === 400');
    expect(core).toContain('status === 400');
  });

  it('neither sends a parameter these models reject', () => {
    for (const banned of ['temperature', 'top_p', 'top_k', 'budget_tokens']) {
      // Mentioned in comments explaining the omission, never as a request field.
      expect(edge, `edge sets ${banned}`).not.toMatch(new RegExp(`^\\s*${banned}:`, 'm'));
      expect(core, `core sets ${banned}`).not.toMatch(new RegExp(`^\\s*${banned}:`, 'm'));
    }
  });

  it('emits the same SSE wire shape the client parses', () => {
    for (const src of [edge, core]) {
      expect(src).toContain('emit(controller, { text:');
      expect(src).toContain('emit(controller, { error:');
      expect(src).toContain('text_delta');
    }
  });

  it('neither imports the SDK, which cannot run on the Edge Runtime', () => {
    // @anthropic-ai/sdk reaches for node:fs, node:child_process and
    // node:readline. Importing it in the edge function failed the Vercel build
    // outright; keeping dev on the SDK and production on fetch would mean the
    // path exercised in dev is not the path that ships.
    for (const src of [edge, core]) {
      expect(src).not.toMatch(/^import .*@anthropic-ai\/sdk/m);
      expect(src).toContain('https://api.anthropic.com/v1/messages');
      expect(src).toContain("'anthropic-version'");
    }
  });

  it('reads the key from a non-VITE env var, so it never reaches the browser', () => {
    expect(edge).toContain('process.env.ANTHROPIC_API_KEY');
    expect(edge).not.toContain('VITE_ANTHROPIC');
    expect(core).not.toContain('VITE_ANTHROPIC');
  });
});
