import { describe, expect, it } from 'vitest';
import { matchesNewCommand } from './paletteCommands';

describe('matchesNewCommand', () => {
  it('matches the word itself, and its prefixes', () => {
    expect(matchesNewCommand('new')).toBe(true);
    expect(matchesNewCommand('ne')).toBe(true);
    expect(matchesNewCommand('n')).toBe(true);
  });

  it('ignores case and surrounding space', () => {
    expect(matchesNewCommand('New')).toBe(true);
    expect(matchesNewCommand('  NEW ')).toBe(true);
  });

  it('matches in the other interface languages', () => {
    expect(matchesNewCommand('ใหม่')).toBe(true);
    expect(matchesNewCommand('สร้าง')).toBe(true);
    expect(matchesNewCommand('新規')).toBe(true);
  });

  it('also matches the other words for the same action', () => {
    expect(matchesNewCommand('notebook')).toBe(true);
    expect(matchesNewCommand('create')).toBe(true);
  });

  it('does not fire on a topic that merely starts the same way', () => {
    // "neural networks" is something to learn, not a request to create.
    expect(matchesNewCommand('neu')).toBe(false);
    expect(matchesNewCommand('neural networks')).toBe(false);
    expect(matchesNewCommand('news cycle')).toBe(false);
  });

  it('does not fire on a word that merely contains it', () => {
    // Prefix matching, not substring: "renew" is not "new".
    expect(matchesNewCommand('renew')).toBe(false);
    expect(matchesNewCommand('anew')).toBe(false);
  });

  it('does not fire on an empty query', () => {
    // With nothing typed the palette lists notebooks; an action row at the top
    // would steal the Enter key from the notebook you came to open.
    expect(matchesNewCommand('')).toBe(false);
    expect(matchesNewCommand('   ')).toBe(false);
  });
});
