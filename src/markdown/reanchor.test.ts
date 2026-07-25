import { describe, expect, it } from 'vitest';
import { reanchorHighlights } from './reanchor';
import type { Highlight } from '../model/types';

function hl(id: string, start: number, end: number, text: string): Highlight {
  return { id, start, end, text, childNodeId: `q-${id}` };
}

const OLD_MD = 'Compound interest means interest earns interest.';

describe('reanchorHighlights', () => {
  it('rewrites offsets when the quote moved in the regenerated text', () => {
    const h = hl('h1', 0, 8, 'Compound');
    expect(OLD_MD.slice(h.start, h.end)).toBe('Compound'); // valid before

    const newMd = 'In finance, Compound interest is interest on interest.';
    const [out] = reanchorHighlights(newMd, [h]);
    expect(newMd.slice(out!.start, out!.end)).toBe('Compound');
    expect(out!.start).toBe(12);
    expect(out!.childNodeId).toBe('q-h1'); // link to the question node survives
  });

  it('leaves an already-correct highlight untouched', () => {
    const h = hl('h1', 0, 8, 'Compound');
    const [out] = reanchorHighlights(OLD_MD, [h]);
    expect(out).toBe(h); // same object — nothing rewritten
  });

  it('collapses to a zero-width anchor when the quote is gone', () => {
    const h = hl('h1', 0, 8, 'Compound');
    const [out] = reanchorHighlights('A totally different lesson chunk.', [h]);
    expect(out!.start).toBe(0);
    expect(out!.end).toBe(0);
    // The branch stays anchored to its parent; it just draws no underline.
    expect(out!.childNodeId).toBe('q-h1');
    expect(out!.text).toBe('Compound');
  });

  it('keeps repeated quotes in order instead of stacking on the first match', () => {
    const md = 'interest ... interest ... interest';
    const hs = [
      hl('a', 0, 8, 'interest'),
      hl('b', 13, 21, 'interest'),
      hl('c', 26, 34, 'interest'),
    ];
    const out = reanchorHighlights(md, hs);
    expect(out.map((h) => h.start)).toEqual([0, 13, 26]);
    expect(new Set(out.map((h) => h.start)).size).toBe(3);
  });

  it('preserves whole-node idea anchors as zero width', () => {
    const idea: Highlight = { id: 'i1', start: 0, end: 0, text: '', childNodeId: 'q-i1' };
    const [out] = reanchorHighlights('anything at all', [idea]);
    expect(out).toEqual(idea);
  });

  it('re-anchors a quote whose stale offsets happen to land on other text', () => {
    // The classic silent corruption: offsets still "work" but point at the
    // wrong words, so the underline appears under unrelated text.
    const h = hl('h1', 9, 17, 'interest');
    const newMd = 'XXXXXXXXXYYYYYYYY and then interest appears later.';
    expect(newMd.slice(h.start, h.end)).toBe('YYYYYYYY'); // wrong text, no error
    const [out] = reanchorHighlights(newMd, [h]);
    expect(newMd.slice(out!.start, out!.end)).toBe('interest');
  });
});
