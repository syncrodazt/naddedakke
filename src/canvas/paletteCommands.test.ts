import { describe, expect, it } from 'vitest';
import { digitTarget, matchesNewCommand } from './paletteCommands';

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

describe('digitTarget', () => {
  it('jumps to the nth row while the box is empty', () => {
    expect(digitTarget('1', '', 5)).toBe(0);
    expect(digitTarget('3', '', 5)).toBe(2);
    expect(digitTarget('5', '', 5)).toBe(4);
  });

  it('ignores digits once something has been typed', () => {
    // A notebook called "1999" has to stay findable.
    expect(digitTarget('1', '19', 5)).toBeNull();
    expect(digitTarget('9', 'a', 5)).toBeNull();
  });

  it('treats a whitespace-only box as empty', () => {
    expect(digitTarget('2', '  ', 5)).toBe(1);
  });

  it('ignores a digit past the end of the list', () => {
    expect(digitTarget('4', '', 3)).toBeNull();
    expect(digitTarget('1', '', 0)).toBeNull();
  });

  it('has no zero — the badges start at 1', () => {
    expect(digitTarget('0', '', 5)).toBeNull();
  });

  it('ignores keys that are not single digits', () => {
    expect(digitTarget('a', '', 5)).toBeNull();
    expect(digitTarget('Enter', '', 5)).toBeNull();
    expect(digitTarget('F1', '', 5)).toBeNull();
    expect(digitTarget('', '', 5)).toBeNull();
  });
});
