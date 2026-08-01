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
