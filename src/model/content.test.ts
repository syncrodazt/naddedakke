import { describe, expect, it } from 'vitest';
import { displayContent, quoteFor, resolveContent } from './content';
import type { Highlight, RNode } from './types';

function h(over: Partial<Highlight> = {}): Highlight {
  return { id: 'h1', start: 0, end: 0, text: '', ...over };
}

function content(over: Partial<RNode['content']> = {}): RNode['content'] {
  return { md: '', highlights: [], ...over };
}

describe('quoteFor', () => {
  it('uses the highlight text in its own body language', () => {
    expect(quoteFor(h({ text: '複利' }), 'ja', 'ja')).toBe('複利');
    // Untagged highlight in an untagged node: both are "the original".
    expect(quoteFor(h({ text: '複利' }), undefined, undefined)).toBe('複利');
  });

  it('uses the translated quote in another language', () => {
    const highlight = h({ text: '複利', quotes: { th: 'ดอกเบี้ยทบต้น' } });
    expect(quoteFor(highlight, 'th', 'ja')).toBe('ดอกเบี้ยทบต้น');
    expect(quoteFor(highlight, 'en', 'ja')).toBe('');
  });

  it('treats a highlight made in a translation as native to that language', () => {
    // Made while reading Thai, in a node originally written in Japanese.
    const highlight = h({ text: 'ดอกเบี้ยทบต้น', lang: 'th', quotes: { ja: '複利' } });
    expect(quoteFor(highlight, 'th', 'ja')).toBe('ดอกเบี้ยทบต้น');
    expect(quoteFor(highlight, 'ja', 'ja')).toBe('複利');
  });

  it('has no quote for an unlabelled original body', () => {
    // The original's language is unknown, so there is nothing to key a quote by.
    expect(quoteFor(h({ text: 'x', lang: 'th' }), undefined, undefined)).toBe('');
  });
});

describe('resolveContent', () => {
  const JA = 'これは複利の話です。';
  const TH = 'นี่คือเรื่องดอกเบี้ยทบต้น';

  const node = content({
    md: JA,
    lang: 'ja',
    translations: { th: TH },
    highlights: [
      {
        id: 'h1',
        start: JA.indexOf('複利'),
        end: JA.indexOf('複利') + 2,
        text: '複利',
        quotes: { th: 'ดอกเบี้ยทบต้น' },
        childNodeId: 'q1',
      },
    ],
  });

  it('returns the original when no language is wanted', () => {
    const out = resolveContent(node, undefined);
    expect(out.md).toBe(JA);
    expect(out.translated).toBe(false);
    expect(out.highlights).toBe(node.highlights);
  });

  it('returns the original when the wanted language is what it is written in', () => {
    expect(resolveContent(node, 'ja').md).toBe(JA);
    expect(resolveContent(node, 'ja').translated).toBe(false);
  });

  it('falls back to the original when that translation is missing', () => {
    const out = resolveContent(node, 'en');
    expect(out.md).toBe(JA);
    expect(out.translated).toBe(false);
    expect(out.bodyLang).toBe('ja');
  });

  it('re-anchors highlights onto the translated quote', () => {
    const out = resolveContent(node, 'th');
    expect(out.md).toBe(TH);
    expect(out.translated).toBe(true);
    const [highlight] = out.highlights;
    expect(highlight).toBeDefined();
    // The offsets must point at the Thai phrase inside the Thai body — not at
    // the character positions the Japanese highlight had.
    expect(TH.slice(highlight!.start, highlight!.end)).toBe('ดอกเบี้ยทบต้น');
    expect(highlight!.start).toBeGreaterThan(0);
    // The link to the question node survives translation.
    expect(highlight!.childNodeId).toBe('q1');
  });

  it('collapses a highlight with no translated quote to a zero-width anchor', () => {
    const orphaned = content({
      md: JA,
      lang: 'ja',
      translations: { th: TH },
      highlights: [{ id: 'h1', start: 3, end: 5, text: '複利', childNodeId: 'q1' }],
    });
    const [highlight] = resolveContent(orphaned, 'th').highlights;
    expect(highlight).toEqual({ id: 'h1', start: 0, end: 0, text: '', childNodeId: 'q1' });
  });

  it('keeps a highlight made in the translation anchored where it was made', () => {
    const native = content({
      md: JA,
      lang: 'ja',
      translations: { th: TH },
      highlights: [
        {
          id: 'h2',
          start: TH.indexOf('ทบต้น'),
          end: TH.indexOf('ทบต้น') + 'ทบต้น'.length,
          text: 'ทบต้น',
          lang: 'th',
          childNodeId: 'q2',
        },
      ],
    });
    const [highlight] = resolveContent(native, 'th').highlights;
    expect(TH.slice(highlight!.start, highlight!.end)).toBe('ทบต้น');
    // …and shows nothing in the original, where that text does not exist.
    const [inOriginal] = resolveContent(native, 'ja').highlights;
    expect(inOriginal!.start).toBe(inOriginal!.end);
  });

  it('does not translate a body that has no translations at all', () => {
    const plain = content({ md: 'hello' });
    expect(resolveContent(plain, 'th').md).toBe('hello');
  });
});

describe('displayContent', () => {
  it('returns the identical object for repeat calls, per language', () => {
    const c = content({
      md: 'ab',
      lang: 'ja',
      translations: { th: 'xy' },
      highlights: [{ id: 'h', start: 0, end: 1, text: 'a', quotes: { th: 'x' } }],
    });
    // Identity is what keeps MarkdownContent's memo alive across renders.
    expect(displayContent(c, 'th')).toBe(displayContent(c, 'th'));
    expect(displayContent(c, undefined)).toBe(displayContent(c, undefined));
    expect(displayContent(c, 'th')).not.toBe(displayContent(c, undefined));
  });

  it('is keyed on the content object, so an edit invalidates it', () => {
    const before = content({ md: 'a', lang: 'ja', translations: { th: 'x' } });
    const after = { ...before, translations: { th: 'z' } };
    expect(displayContent(before, 'th').md).toBe('x');
    expect(displayContent(after, 'th').md).toBe('z');
  });
});
