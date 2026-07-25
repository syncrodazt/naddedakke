import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGenerationConfig, isChatPayload, sanitizeModel } from './gemini.ts';

describe('proxy payload + model guards', () => {
  it('accepts a well-formed chat payload with optional model', () => {
    expect(isChatPayload({ system: 'a', user: 'b' })).toBe(true);
    expect(isChatPayload({ system: 'a', user: 'b', model: 'gemini-flash-latest' })).toBe(true);
    expect(isChatPayload({ system: 'a' })).toBe(false);
    expect(isChatPayload({ system: 'a', user: 'b', model: 5 })).toBe(false);
    expect(isChatPayload(null)).toBe(false);
  });

  it('allows only real Gemini/Gemma id characters, rejecting path injection', () => {
    expect(sanitizeModel('gemini-flash-latest')).toBe('gemini-flash-latest');
    expect(sanitizeModel('gemini-2.5-flash-lite')).toBe('gemini-2.5-flash-lite');
    expect(sanitizeModel('gemma-4-26b-a4b-it')).toBe('gemma-4-26b-a4b-it');
    expect(sanitizeModel(undefined)).toBeNull();
    expect(sanitizeModel('')).toBeNull();
    expect(sanitizeModel('../secret')).toBeNull();
    expect(sanitizeModel('gemini:streamGenerateContent?x=1')).toBeNull();
    expect(sanitizeModel('a b')).toBeNull();
  });
});

describe('buildGenerationConfig', () => {
  const base = { system: 's', user: 'u' };

  it('asks for enough output tokens to survive a thinking model', () => {
    // Thinking tokens are billed against maxOutputTokens; too small a budget
    // returns an empty response rather than an error, which is how the goal
    // decomposition silently produced "no JSON object".
    const cfg = buildGenerationConfig(base, true) as { maxOutputTokens: number };
    expect(cfg.maxOutputTokens).toBeGreaterThanOrEqual(8192);
  });

  it('requests structured output only when asked', () => {
    expect(buildGenerationConfig(base, true)).not.toHaveProperty('responseMimeType');
    expect(buildGenerationConfig({ ...base, json: true }, true)).toMatchObject({
      responseMimeType: 'application/json',
    });
  });

  it('disables thinking only when asked', () => {
    expect(buildGenerationConfig(base, true)).not.toHaveProperty('thinkingConfig');
    expect(buildGenerationConfig({ ...base, noThinking: true }, true)).toMatchObject({
      thinkingConfig: { thinkingBudget: 0 },
    });
  });

  it('drops the optional hints for the retry, keeping the token budget', () => {
    // Models that do not understand these fields reject the whole request, so
    // the retry must be a plain one.
    const cfg = buildGenerationConfig({ ...base, json: true, noThinking: true }, false);
    expect(cfg).toEqual({ maxOutputTokens: 8192 });
  });
});

describe('isChatPayload', () => {
  it('accepts the optional hints', () => {
    expect(isChatPayload({ system: 's', user: 'u', json: true, noThinking: true })).toBe(true);
  });

  it('rejects hints of the wrong type', () => {
    expect(isChatPayload({ system: 's', user: 'u', json: 'yes' })).toBe(false);
  });
});

// The Vercel edge function inlines this proxy because Vercel compiles each
// api/* file standalone. Two copies drift; these are the parts that must not.
describe('api/chat.ts stays in sync with the proxy core', () => {
  const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');
  const edge = read('api/chat.ts');
  const core = read('server/gemini.ts');

  it('uses the same output token budget', () => {
    const of = (src: string) => /MAX_OUTPUT_TOKENS = (\d+)/.exec(src)?.[1];
    expect(of(edge)).toBe(of(core));
    expect(of(edge)).toBe('8192');
  });

  it('sends the same optional generation hints', () => {
    for (const field of ['responseMimeType', 'thinkingConfig', 'thinkingBudget']) {
      expect(edge, `edge missing ${field}`).toContain(field);
      expect(core, `core missing ${field}`).toContain(field);
    }
  });

  it('both retry without the optional hints on a 400', () => {
    expect(edge).toContain('status === 400');
    expect(core).toContain('status === 400');
  });
});
