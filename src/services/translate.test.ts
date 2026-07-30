import { describe, expect, it } from 'vitest';
import { TranslateError, chunkInto, parseTranslation, pendingItems } from './translate';
import type { RNode } from '../model/types';

function node(id: string, over: Partial<RNode> = {}): RNode {
  return {
    id,
    sessionId: 's',
    kind: 'chunk',
    seq: 1,
    position: { x: 0, y: 0 },
    content: { md: `body ${id}`, highlights: [] },
    ...over,
  };
}

function asMap(nodes: RNode[]): Record<string, RNode> {
  return Object.fromEntries(nodes.map((n) => [n.id, n]));
}

describe('chunkInto', () => {
  it('splits into batches of at most the given size', () => {
    expect(chunkInto([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkInto([], 3)).toEqual([]);
    expect(chunkInto([1, 2], 8)).toEqual([[1, 2]]);
  });

  it('keeps every item exactly once', () => {
    const items = Array.from({ length: 17 }, (_, i) => i);
    expect(chunkInto(items, 5).flat()).toEqual(items);
  });

  it('rejects a batch size that would loop forever', () => {
    expect(() => chunkInto([1], 0)).toThrow();
  });
});

describe('pendingItems', () => {
  it('sends nodes that have no translation yet, oldest first', () => {
    const nodes = asMap([node('b', { seq: 2 }), node('a', { seq: 1 })]);
    expect(pendingItems(nodes, 'th').map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('skips nodes already written in the target language', () => {
    const nodes = asMap([node('a', { content: { md: 'x', highlights: [], lang: 'th' } })]);
    expect(pendingItems(nodes, 'th')).toEqual([]);
  });

  it('skips nodes already translated, so re-running costs only the new ones', () => {
    const nodes = asMap([
      node('done', { content: { md: 'x', highlights: [], translations: { th: 'y' } } }),
      node('fresh'),
    ]);
    expect(pendingItems(nodes, 'th').map((i) => i.id)).toEqual(['fresh']);
  });

  it('still sends a node translated into a different language', () => {
    const nodes = asMap([
      node('a', { content: { md: 'x', highlights: [], translations: { en: 'y' } } }),
    ]);
    expect(pendingItems(nodes, 'th').map((i) => i.id)).toEqual(['a']);
  });

  it('skips empty bodies — a node still streaming has nothing to translate', () => {
    const nodes = asMap([node('a', { content: { md: '   \n', highlights: [] } })]);
    expect(pendingItems(nodes, 'th')).toEqual([]);
  });

  it('carries the highlighted quotes, dropping zero-width idea anchors', () => {
    const nodes = asMap([
      node('a', {
        content: {
          md: 'compound interest grows',
          highlights: [
            { id: 'h1', start: 0, end: 8, text: 'compound' },
            { id: 'h2', start: 0, end: 0, text: '' },
          ],
        },
      }),
    ]);
    expect(pendingItems(nodes, 'th')[0]?.quotes).toEqual([{ id: 'h1', text: 'compound' }]);
  });
});

describe('parseTranslation', () => {
  it('reads the items and their quotes', () => {
    const raw = JSON.stringify({
      items: [
        { id: 'n1', sourceLang: 'ja', md: 'สวัสดี โลก', quotes: [{ id: 'h1', text: 'โลก' }] },
      ],
    });
    expect(parseTranslation(raw)).toEqual([
      { id: 'n1', sourceLang: 'ja', md: 'สวัสดี โลก', quotes: [{ id: 'h1', text: 'โลก' }] },
    ]);
  });

  it('accepts a reply wrapped in a code fence', () => {
    const raw = '```json\n{"items":[{"id":"n1","md":"hi","quotes":[]}]}\n```';
    expect(parseTranslation(raw)[0]?.id).toBe('n1');
  });

  it('drops a quote that does not occur in the body it came back with', () => {
    // Keeping it would anchor the highlight at whatever `indexOf` finds
    // instead — a wrong underline is worse than no underline.
    const raw = JSON.stringify({
      items: [
        {
          id: 'n1',
          md: 'สวัสดี โลก',
          quotes: [
            { id: 'h1', text: 'โลก' },
            { id: 'h2', text: 'ไม่มีอยู่จริง' },
          ],
        },
      ],
    });
    expect(parseTranslation(raw)[0]?.quotes).toEqual([{ id: 'h1', text: 'โลก' }]);
  });

  it('drops malformed items but keeps the rest of the batch', () => {
    const raw = JSON.stringify({
      items: [
        { id: 'n1', md: 'ok', quotes: [] },
        { id: '', md: 'no id', quotes: [] },
        { id: 'n3', md: '   ', quotes: [] },
        { id: 'n4', md: 'also ok' },
      ],
    });
    expect(parseTranslation(raw).map((i) => i.id)).toEqual(['n1', 'n4']);
  });

  it('omits sourceLang when the model did not report one', () => {
    const parsed = parseTranslation(JSON.stringify({ items: [{ id: 'n1', md: 'x', quotes: [] }] }));
    expect(parsed[0]).not.toHaveProperty('sourceLang');
  });

  it('rejects a reply that is not usable at all', () => {
    expect(() => parseTranslation('not json')).toThrow(TranslateError);
    expect(() => parseTranslation('{"nope":1}')).toThrow(TranslateError);
    expect(() => parseTranslation('{"items":[]}')).toThrow(TranslateError);
    expect(() => parseTranslation('{"items":[{"id":"n1"}]}')).toThrow(TranslateError);
  });
});
