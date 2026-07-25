import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_MODELS,
  buildMessageParams,
  isClaudeModel,
  isClaudePayload,
  sanitizeClaudeModel,
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

describe('buildMessageParams', () => {
  it('never sends parameters these models reject', () => {
    // temperature / top_p / top_k / thinking.budget_tokens are 400s on Opus 5.
    const params = buildMessageParams(
      { ...base, schema: { type: 'object' } },
      'claude-opus-5',
      true,
    );
    for (const banned of ['temperature', 'top_p', 'top_k', 'thinking']) {
      expect(params).not.toHaveProperty(banned);
    }
  });

  it('leaves room for thinking in the token budget', () => {
    // Thinking is on by default and is billed against max_tokens; a budget
    // sized for the prose alone is how a deliberating model returns nothing.
    expect(buildMessageParams(base, 'claude-opus-5', false).max_tokens).toBeGreaterThanOrEqual(
      16000,
    );
  });

  it('attaches the schema only when asked, and defaults effort to medium', () => {
    const schema = { type: 'object' };
    expect(buildMessageParams({ ...base, schema }, 'claude-opus-5', true).output_config).toEqual({
      effort: 'medium',
      format: { type: 'json_schema', schema },
    });
    // The 400 retry drops the schema but must keep everything else.
    expect(buildMessageParams({ ...base, schema }, 'claude-opus-5', false).output_config).toEqual({
      effort: 'medium',
    });
    expect(
      buildMessageParams({ ...base, effort: 'high' }, 'claude-opus-5', true).output_config,
    ).toEqual({ effort: 'high' });
  });

  it('puts the prompt in the system field, not the user turn', () => {
    const params = buildMessageParams(base, 'claude-opus-5', false);
    expect(params.system).toBe('s');
    expect(params.messages).toEqual([{ role: 'user', content: 'u' }]);
    expect(params.stream).toBe(true);
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
      expect(src).toContain('sse({ text:');
      expect(src).toContain('sse({ error:');
      expect(src).toContain('text_delta');
    }
  });

  it('reads the key from a non-VITE env var, so it never reaches the browser', () => {
    expect(edge).toContain('process.env.ANTHROPIC_API_KEY');
    expect(edge).not.toContain('VITE_ANTHROPIC');
    expect(core).not.toContain('VITE_ANTHROPIC');
  });
});
