import { describe, expect, it } from 'vitest';
import { SHORTCUTS, keyCaps, modLabel } from './shortcuts';
import { dict, LANGS } from '../i18n/dict';

describe('modLabel', () => {
  it('shows the key the machine actually has', () => {
    // Telling a Mac user to press Ctrl is documenting a shortcut that does not
    // work on their keyboard.
    expect(modLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('⌘');
    expect(modLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('⌘');
    expect(modLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Ctrl');
    expect(modLabel('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Ctrl');
  });
});

describe('keyCaps', () => {
  it('resolves Mod and leaves every other cap alone', () => {
    expect(keyCaps({ keys: ['Mod', 'Shift', 'Z'], label: 'scRedo' }, '⌘')).toEqual([
      '⌘',
      'Shift',
      'Z',
    ]);
    expect(keyCaps({ keys: ['Shift', '1'], label: 'scFitAll' }, 'Ctrl')).toEqual(['Shift', '1']);
  });
});

describe('the shortcut list', () => {
  it('describes every entry in every language', () => {
    // An untranslated row would render as blank space next to a key cap, which
    // reads as a shortcut that does nothing.
    for (const { id, label } of LANGS) {
      const strings = dict[id];
      for (const group of SHORTCUTS) {
        expect(typeof strings[group.title], `${label}: ${String(group.title)}`).toBe('string');
        for (const item of group.items) {
          expect(typeof strings[item.label], `${label}: ${String(item.label)}`).toBe('string');
        }
      }
    }
  });

  it('never lists the same action twice', () => {
    const labels = SHORTCUTS.flatMap((g) => g.items.map((i) => i.label));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('gives every entry at least one key', () => {
    for (const group of SHORTCUTS) {
      for (const item of group.items) {
        expect(item.keys.length, String(item.label)).toBeGreaterThan(0);
      }
    }
  });

  it('claims no shortcut the browser will not let us have', () => {
    // Ctrl/⌘ plus a digit switches browser tabs and cannot be intercepted, so a
    // shortcut listed here on those keys would simply not work.
    for (const group of SHORTCUTS) {
      for (const item of group.items) {
        const hasMod = item.keys.includes('Mod');
        const hasDigit = item.keys.some((k) => /^[0-9]$/.test(k));
        expect(hasMod && hasDigit, String(item.label)).toBe(false);
      }
    }
  });
});
