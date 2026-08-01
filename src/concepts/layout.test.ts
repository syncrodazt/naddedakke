import { describe, expect, it } from 'vitest';
import { CARD_H, COL_W, ROW_GAP, depths, layoutConcepts, sizeTier } from './layout';
import type { Concept, ConceptMap } from './types';

function concept(id: string, prereqs: string[] = []): Concept {
  return { id, name: id, blurb: '', prereqs, sessionIds: [] };
}

function map(...concepts: Concept[]): ConceptMap {
  return { id: 'current', generatedAt: 0, builtFrom: [], concepts };
}

describe('sizeTier', () => {
  it('grows with what a concept opens up', () => {
    expect(sizeTier(0)).toBe('small');
    expect(sizeTier(1)).toBe('small');
    expect(sizeTier(2)).toBe('medium');
    expect(sizeTier(9)).toBe('large');
  });
});

describe('depths', () => {
  it('puts a concept one past the deepest thing it needs', () => {
    const d = depths(map(concept('a'), concept('b', ['a']), concept('c', ['a', 'b'])));
    expect(d).toEqual({ a: 0, b: 1, c: 2 });
  });

  it('starts every root at zero', () => {
    expect(depths(map(concept('a'), concept('b')))).toEqual({ a: 0, b: 0 });
  });

  it('ignores a prerequisite that is not in the map', () => {
    expect(depths(map(concept('a', ['ghost'])))).toEqual({ a: 0 });
  });

  it('survives a cycle instead of recursing forever', () => {
    const d = depths(map(concept('a', ['b']), concept('b', ['a'])));
    expect(Object.keys(d).sort()).toEqual(['a', 'b']);
    expect(Number.isFinite(d.a!) && Number.isFinite(d.b!)).toBe(true);
  });
});

describe('layoutConcepts', () => {
  it('places columns left to right by depth', () => {
    const m = map(concept('root'), concept('mid', ['root']), concept('leaf', ['mid']));
    const out = layoutConcepts(m, {});
    expect(out.root!.x).toBe(0);
    expect(out.mid!.x).toBe(COL_W);
    expect(out.leaf!.x).toBe(COL_W * 2);
  });

  it('never overlaps two cards in the same column', () => {
    const m = map(concept('a'), concept('b'), concept('c'));
    const out = layoutConcepts(m, {});
    const ys = ['a', 'b', 'c'].map((id) => out[id]!.y).sort((p, q) => p - q);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(CARD_H + ROW_GAP);
    }
  });

  it('leaves room between columns for the widest card', () => {
    const m = map(concept('a'), concept('b', ['a']));
    const out = layoutConcepts(m, { a: 9 }); // a is 'large'
    expect(out.b!.x - out.a!.x).toBeGreaterThan(out.a!.width);
  });

  it('sizes cards by what they unlock', () => {
    const m = map(concept('big'), concept('small'));
    const out = layoutConcepts(m, { big: 9, small: 0 });
    expect(out.big!.tier).toBe('large');
    expect(out.small!.tier).toBe('small');
    expect(out.big!.width).toBeGreaterThan(out.small!.width);
  });

  it('places a concept near the prerequisites it comes from', () => {
    // Roots sort by name: bottom(0), middle(1), top(2). `zeta` hangs off the
    // top row and `alpha` off the bottom one, so the barycentre puts zeta
    // first — the opposite of what sorting the column by name would give.
    const m = map(
      concept('bottom'),
      concept('middle'),
      concept('top'),
      concept('zeta', ['bottom']),
      concept('alpha', ['top']),
    );
    const out = layoutConcepts(m, {});
    expect(out.zeta!.y).toBeLessThan(out.alpha!.y);
  });

  it('puts the higher-leverage concept above when nothing else separates them', () => {
    const m = map(concept('a'), concept('b'));
    const out = layoutConcepts(m, { a: 0, b: 7 });
    expect(out.b!.y).toBeLessThan(out.a!.y);
  });

  it('is deterministic', () => {
    const m = map(concept('c'), concept('a'), concept('b', ['a']));
    expect(layoutConcepts(m, {})).toEqual(layoutConcepts(m, {}));
  });

  it('places every concept exactly once', () => {
    const m = map(concept('a'), concept('b', ['a']), concept('c', ['a']), concept('d', ['b', 'c']));
    const out = layoutConcepts(m, {});
    expect(Object.keys(out).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('handles an empty map', () => {
    expect(layoutConcepts(map(), {})).toEqual({});
  });
});
