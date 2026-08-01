import { describe, expect, it } from 'vitest';
import {
  analoguesOf,
  ancestors,
  dependents,
  directDependents,
  directPrereqs,
  lineage,
  sameAsPairs,
} from './graph';
import type { Concept, ConceptMap } from './types';

function concept(id: string, prereqs: string[] = []): Concept {
  return { id, name: id, area: 'A', blurb: '', prereqs, sessionIds: [] };
}

function map(...concepts: Concept[]): ConceptMap {
  return { id: 'current', generatedAt: 0, builtFrom: [], concepts };
}

//   root ─┬─ mid ── leaf
//         └─ aside
//   loner
const m = map(
  concept('root'),
  concept('mid', ['root']),
  concept('leaf', ['mid']),
  concept('aside', ['root']),
  concept('loner'),
);

describe('ancestors', () => {
  it('walks all the way to the roots', () => {
    expect(ancestors(m, 'leaf')).toEqual(new Set(['mid', 'root']));
    expect(ancestors(m, 'root')).toEqual(new Set());
  });

  it('survives a cycle that does not pass through where it started', () => {
    // a → b → c → b. Excluding the start is not enough here: without a visited
    // set the walk bounces between b and c forever.
    const cyclic = map(concept('a', ['b']), concept('b', ['c']), concept('c', ['b']));
    expect(ancestors(cyclic, 'a')).toEqual(new Set(['b', 'c']));
  });
});

describe('dependents', () => {
  it('walks all the way down', () => {
    expect(dependents(m, 'root')).toEqual(new Set(['mid', 'leaf', 'aside']));
    expect(dependents(m, 'leaf')).toEqual(new Set());
  });

  it('survives a cycle downstream of where it started', () => {
    const cyclic = map(concept('a'), concept('b', ['a', 'c']), concept('c', ['b']));
    expect(dependents(cyclic, 'a')).toEqual(new Set(['b', 'c']));
  });
});

describe('directPrereqs / directDependents', () => {
  it('gives only the immediate neighbours', () => {
    expect(directPrereqs(m, 'leaf')).toEqual(['mid']);
    expect(directDependents(m, 'root')).toEqual(['mid', 'aside']);
    expect(directDependents(m, 'leaf')).toEqual([]);
  });

  it('leaves out a prerequisite that names nothing', () => {
    expect(directPrereqs(map(concept('a', ['ghost'])), 'a')).toEqual([]);
  });

  it('is empty for a concept that is not in the map', () => {
    expect(directPrereqs(m, 'ghost')).toEqual([]);
    expect(directDependents(m, 'ghost')).toEqual([]);
  });
});

describe('lineage', () => {
  it('is the concept plus everything above and below it', () => {
    // This is what stays lit when a concept is selected in the tree.
    expect(lineage(m, 'mid')).toEqual(new Set(['mid', 'root', 'leaf']));
  });

  it('leaves out a sibling branch, which is what makes selecting useful', () => {
    // `aside` shares a root but is not on the path through `mid` — it fades.
    expect(lineage(m, 'mid').has('aside')).toBe(false);
  });

  it('leaves out anything unconnected', () => {
    expect(lineage(m, 'mid').has('loner')).toBe(false);
  });

  it('includes the concept itself even with nothing attached', () => {
    expect(lineage(m, 'loner')).toEqual(new Set(['loner']));
  });
});

describe('cross-domain links', () => {
  function linked(): ConceptMap {
    return {
      id: 'current',
      generatedAt: 0,
      builtFrom: [],
      concepts: [
        {
          id: 'ui',
          name: 'UI tree',
          area: 'UI',
          blurb: '',
          prereqs: [],
          sessionIds: [],
          sameAs: [{ id: 'cad', how: 'Both are hierarchies of parts.' }],
        },
        { id: 'cad', name: 'CAD tree', area: 'CAD', blurb: '', prereqs: [], sessionIds: [] },
        { id: 'other', name: 'Other', area: 'CAD', blurb: '', prereqs: [], sessionIds: [] },
      ],
    };
  }

  it('shows the link on BOTH cards, though it is stored once', () => {
    const m = linked();
    expect(analoguesOf(m, 'ui').map((l) => l.id)).toEqual(['cad']);
    expect(analoguesOf(m, 'cad').map((l) => l.id)).toEqual(['ui']);
  });

  it('carries the justification either way round', () => {
    expect(analoguesOf(linked(), 'cad')[0]!.how).toBe('Both are hierarchies of parts.');
  });

  it('lists every pair once', () => {
    expect(sameAsPairs(linked())).toEqual([
      { a: 'ui', b: 'cad', how: 'Both are hierarchies of parts.' },
    ]);
  });

  it('lights up the analogue when a concept is selected', () => {
    // Otherwise the link would be drawn to a card that had just been faded out.
    expect(lineage(linked(), 'ui').has('cad')).toBe(true);
    expect(lineage(linked(), 'ui').has('other')).toBe(false);
  });

  it('is not a prerequisite, so it changes nothing about what unlocks what', () => {
    // Asserted from the side that HOLDS the link: walking prerequisites from
    // `ui` must not wander across to `cad`, or an analogy would silently become
    // something you have to learn first.
    const m = linked();
    expect(ancestors(m, 'ui')).toEqual(new Set());
    expect(dependents(m, 'ui')).toEqual(new Set());
    expect(ancestors(m, 'cad')).toEqual(new Set());
  });
});
