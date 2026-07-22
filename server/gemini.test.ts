import { describe, expect, it } from 'vitest';
import { isChatPayload, sanitizeModel } from './gemini.ts';

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
