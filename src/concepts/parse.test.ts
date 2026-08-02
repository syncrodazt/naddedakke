import { describe, expect, it } from 'vitest';
import { ConceptMapError, breakCycles, parseConceptMap } from './parse';
import type { Concept } from './types';

const OPTIONS = { knownSessionIds: new Set(['s1', 's2']), generatedAt: 42, builtFrom: ['A'] };

function raw(concepts: unknown[]): string {
  return JSON.stringify({ concepts });
}

describe('parseConceptMap', () => {
  it('reads a well-formed map', () => {
    const map = parseConceptMap(
      raw([
        {
          id: 'sampling',
          name: 'Sampling',
          blurb: 'Turning a wave into numbers.',
          prereqs: [],
          sessionIds: ['s1'],
          why: 'Your MP3 notebook covers it.',
        },
        {
          id: 'quantisation',
          name: 'Quantisation',
          blurb: '',
          prereqs: ['sampling'],
          sessionIds: [],
        },
      ]),
      OPTIONS,
    );
    expect(map.generatedAt).toBe(42);
    expect(map.builtFrom).toEqual(['A']);
    expect(map.concepts.map((c) => c.id)).toEqual(['sampling', 'quantisation']);
    expect(map.concepts[0]!.why).toBe('Your MP3 notebook covers it.');
    expect(map.concepts[1]!.prereqs).toEqual(['sampling']);
  });

  it('accepts a reply wrapped in a code fence', () => {
    const fenced = '```json\n{"concepts":[{"id":"a","name":"A"}]}\n```';
    expect(parseConceptMap(fenced, OPTIONS).concepts[0]!.id).toBe('a');
  });

  it('discards a notebook id the model invented', () => {
    // The one error that HIDES work: a fake link would make an unknown concept
    // look known and drop it out of the recommendations entirely.
    const map = parseConceptMap(
      raw([{ id: 'a', name: 'A', sessionIds: ['s1', 'not-a-real-notebook'] }]),
      OPTIONS,
    );
    expect(map.concepts[0]!.sessionIds).toEqual(['s1']);
  });

  it('drops entries that are unusable, keeping the rest', () => {
    const map = parseConceptMap(
      raw([
        { id: 'good', name: 'Good' },
        { id: 'Bad Id', name: 'Spaces' },
        { id: 'noname', name: '   ' },
        'not an object',
        { id: 'good', name: 'Duplicate' },
        { id: 'also-good', name: 'Also good' },
      ]),
      OPTIONS,
    );
    expect(map.concepts.map((c) => c.id)).toEqual(['good', 'also-good']);
    expect(map.concepts[0]!.name).toBe('Good'); // first wins, not the duplicate
  });

  it('drops a prerequisite pointing at a concept that is not in the map', () => {
    const map = parseConceptMap(raw([{ id: 'a', name: 'A', prereqs: ['ghost', 'a'] }]), OPTIONS);
    expect(map.concepts[0]!.prereqs).toEqual([]);
  });

  it('rejects a reply with nothing usable in it', () => {
    expect(() => parseConceptMap('not json', OPTIONS)).toThrow(ConceptMapError);
    expect(() => parseConceptMap('{"nope":1}', OPTIONS)).toThrow(ConceptMapError);
    expect(() => parseConceptMap(raw([]), OPTIONS)).toThrow(ConceptMapError);
    expect(() => parseConceptMap(raw([{ id: 'BAD' }]), OPTIONS)).toThrow(ConceptMapError);
  });

  it('leaves no cycle in what it returns', () => {
    const map = parseConceptMap(
      raw([
        { id: 'a', name: 'A', prereqs: ['b'] },
        { id: 'b', name: 'B', prereqs: ['a'] },
      ]),
      OPTIONS,
    );
    const edges = map.concepts.flatMap((c) => c.prereqs.map((p) => `${p}->${c.id}`));
    expect(edges.length).toBe(1);
  });
});

describe('breakCycles', () => {
  function concept(id: string, prereqs: string[] = []): Concept {
    return { id, name: id, area: 'A', blurb: '', prereqs, sessionIds: [] };
  }

  it('leaves an acyclic map untouched', () => {
    const input = [concept('a'), concept('b', ['a']), concept('c', ['b'])];
    expect(breakCycles(input)).toEqual(input);
  });

  it('cuts a two-node loop', () => {
    // "Learn A before B, and B before A" is not a curriculum; left in, both
    // would be permanently unstartable and nothing would say why.
    const out = breakCycles([concept('a', ['b']), concept('b', ['a'])]);
    const total = out.reduce((n, c) => n + c.prereqs.length, 0);
    expect(total).toBe(1);
  });

  it('cuts a longer loop but keeps the useful edges', () => {
    const out = breakCycles([
      concept('a', ['c']),
      concept('b', ['a']),
      concept('c', ['b']),
      concept('d', ['a']),
    ]);
    expect(out.reduce((n, c) => n + c.prereqs.length, 0)).toBe(3);
    // The edge that is not part of the loop must survive.
    expect(out.find((c) => c.id === 'd')!.prereqs).toEqual(['a']);
  });

  it('drops a self-reference', () => {
    expect(breakCycles([concept('a', ['a'])])[0]!.prereqs).toEqual([]);
  });

  it('is deterministic', () => {
    const input = [concept('a', ['b']), concept('b', ['c']), concept('c', ['a'])];
    expect(breakCycles(input)).toEqual(breakCycles(input));
  });
});

describe('cross-domain links', () => {
  const base = (over: Record<string, unknown> = {}) => ({
    id: 'ui-tree',
    name: 'Component tree',
    area: 'UI',
    ...over,
  });

  it('keeps a link that crosses subjects and explains itself', () => {
    const map = parseConceptMap(
      raw([
        base({ sameAs: [{ id: 'cad-tree', how: 'Both are a parent-child hierarchy of parts.' }] }),
        { id: 'cad-tree', name: 'Assembly tree', area: 'CAD' },
      ]),
      OPTIONS,
    );
    expect(map.concepts[0]!.sameAs).toEqual([
      { id: 'cad-tree', how: 'Both are a parent-child hierarchy of parts.' },
    ]);
  });

  it('drops a link with no account of HOW they are the same', () => {
    // The most valuable claim here is also the easiest to fabricate, so an
    // unexplained one is discarded rather than shown.
    const map = parseConceptMap(
      raw([
        base({ sameAs: [{ id: 'cad-tree' }, { id: 'cad-tree', how: '   ' }] }),
        { id: 'cad-tree', name: 'Assembly tree', area: 'CAD' },
      ]),
      OPTIONS,
    );
    expect(map.concepts[0]!.sameAs).toBeUndefined();
  });

  it('drops a link inside one subject', () => {
    // The band already puts them side by side; the claim only earns a line when
    // it crosses fields.
    const map = parseConceptMap(
      raw([
        base({ sameAs: [{ id: 'other-ui', how: 'Similar.' }] }),
        { id: 'other-ui', name: 'Other', area: 'UI' },
      ]),
      OPTIONS,
    );
    expect(map.concepts[0]!.sameAs).toBeUndefined();
  });

  it('drops a link to a concept that is not in the map, or to itself', () => {
    const map = parseConceptMap(
      raw([
        base({
          sameAs: [
            { id: 'ghost', how: 'Nope.' },
            { id: 'ui-tree', how: 'Itself.' },
          ],
        }),
      ]),
      OPTIONS,
    );
    expect(map.concepts[0]!.sameAs).toBeUndefined();
  });

  it('keeps a symmetric pair only once', () => {
    const map = parseConceptMap(
      raw([
        base({ sameAs: [{ id: 'cad-tree', how: 'Same hierarchy.' }] }),
        {
          id: 'cad-tree',
          name: 'Assembly tree',
          area: 'CAD',
          sameAs: [{ id: 'ui-tree', how: 'Same hierarchy.' }],
        },
      ]),
      OPTIONS,
    );
    const total = map.concepts.reduce((n, c) => n + (c.sameAs?.length ?? 0), 0);
    expect(total).toBe(1);
  });
});

describe('a reply that ran out of budget', () => {
  it('recovers the concepts that arrived before it was cut off', () => {
    // Thirteen good concepts and one half-written is worth far more than the
    // "could not read the suggestions" that JSON.parse alone would give.
    const truncated =
      '{"concepts":[' +
      '{"id":"a","name":"A","area":"X","prereqs":[],"sessionIds":[]},' +
      '{"id":"b","name":"B","area":"X","prereqs":["a"],"sessionIds":[]},' +
      '{"id":"c","name":"C","area":"X","prer';
    const map = parseConceptMap(truncated, OPTIONS);
    expect(map.concepts.map((c) => c.id)).toEqual(['a', 'b']);
    expect(map.concepts[1]!.prereqs).toEqual(['a']);
  });

  it('is not fooled by a closing brace inside a blurb', () => {
    // A CLOSING brace is the dangerous one: counted as structure it ends the
    // object early, and the half-object left behind fails to parse — so the
    // concept disappears rather than merely reading oddly.
    const truncated =
      '{"concepts":[' +
      '{"id":"a","name":"A","area":"X","blurb":"a closing } brace","prereqs":[],"sessionIds":[]},' +
      '{"id":"b","name":"B"';
    const map = parseConceptMap(truncated, OPTIONS);
    expect(map.concepts.map((c) => c.id)).toEqual(['a']);
    expect(map.concepts[0]!.blurb).toBe('a closing } brace');
  });

  it('is not fooled by an escaped quote', () => {
    // Mis-reading the escape ends the string early, which then exposes the
    // brace inside it as structure and loses the concept.
    const truncated =
      '{"concepts":[{"id":"a","name":"A","area":"X","blurb":"say \\"}\\" now",' +
      '"prereqs":[],"sessionIds":[]},{"id":"b"';
    const map = parseConceptMap(truncated, OPTIONS);
    expect(map.concepts.map((c) => c.id)).toEqual(['a']);
    expect(map.concepts[0]!.blurb).toBe('say "}" now');
  });

  it('says the model returned nothing when it returned nothing', () => {
    // An empty reply and a chatty one need different things done about them, so
    // they must not share a message.
    expect(() => parseConceptMap('   ', OPTIONS)).toThrow(/returned nothing/);
  });

  it('quotes what came back when it was not JSON at all', () => {
    expect(() => parseConceptMap('Sorry, I cannot help with that.', OPTIONS)).toThrow(
      /Sorry, I cannot help/,
    );
  });
});
