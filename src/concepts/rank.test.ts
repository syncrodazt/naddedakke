import { describe, expect, it } from 'vitest';
import { dependents, rankConcepts, statusOf, type Coverage } from './rank';
import type { Concept, ConceptMap } from './types';

function concept(id: string, over: Partial<Concept> = {}): Concept {
  return { id, name: id, blurb: '', prereqs: [], sessionIds: [], ...over };
}

function map(...concepts: Concept[]): ConceptMap {
  return { id: 'current', generatedAt: 0, builtFrom: [], concepts };
}

/** A notebook that is fully understood. */
const done = { understood: 5, total: 5 };
/** A notebook barely started. */
const started = { understood: 1, total: 10 };

describe('statusOf', () => {
  it('is unknown when nothing covers it', () => {
    expect(statusOf(concept('a'), {})).toBe('unknown');
  });

  it('is unknown when the notebook it names is gone', () => {
    expect(statusOf(concept('a', { sessionIds: ['deleted'] }), {})).toBe('unknown');
  });

  it('is known once enough of the notebook is understood', () => {
    const coverage: Coverage = { s1: done };
    expect(statusOf(concept('a', { sessionIds: ['s1'] }), coverage)).toBe('known');
  });

  it('is met when the notebook exists but is barely understood', () => {
    // Having read something is not the same as knowing it.
    expect(statusOf(concept('a', { sessionIds: ['s1'] }), { s1: started })).toBe('met');
  });

  it('does not demand perfection', () => {
    // A notebook one chunk short of complete is knowledge; requiring 100% would
    // mean almost nothing ever counts and the list never moves.
    expect(
      statusOf(concept('a', { sessionIds: ['s1'] }), { s1: { understood: 9, total: 10 } }),
    ).toBe('known');
  });

  it('pools several notebooks covering the same concept', () => {
    const coverage: Coverage = { s1: { understood: 0, total: 5 }, s2: { understood: 5, total: 5 } };
    // Half understood overall — below the bar, so still only met.
    expect(statusOf(concept('a', { sessionIds: ['s1', 's2'] }), coverage)).toBe('met');
  });

  it('treats an empty notebook as met, not known', () => {
    expect(
      statusOf(concept('a', { sessionIds: ['s1'] }), { s1: { understood: 0, total: 0 } }),
    ).toBe('met');
  });
});

describe('dependents', () => {
  const m = map(
    concept('root'),
    concept('mid', { prereqs: ['root'] }),
    concept('leaf', { prereqs: ['mid'] }),
    concept('other'),
  );

  it('follows the chain transitively', () => {
    expect(dependents(m, 'root')).toEqual(new Set(['mid', 'leaf']));
    expect(dependents(m, 'mid')).toEqual(new Set(['leaf']));
    expect(dependents(m, 'leaf')).toEqual(new Set());
  });

  it('survives a cycle instead of hanging', () => {
    // Prerequisites come from a language model; a loop is a mistake to survive.
    const cyclic = map(concept('a', { prereqs: ['b'] }), concept('b', { prereqs: ['a'] }));
    expect(dependents(cyclic, 'a')).toEqual(new Set(['b']));
  });

  it('never counts the concept itself', () => {
    const selfRef = map(concept('a', { prereqs: ['a'] }));
    expect(dependents(selfRef, 'a')).toEqual(new Set());
  });
});

describe('rankConcepts', () => {
  it('leaves out what the learner already knows', () => {
    const m = map(concept('known', { sessionIds: ['s1'] }), concept('new'));
    const ranked = rankConcepts(m, { s1: done });
    expect(ranked.map((r) => r.concept.id)).toEqual(['new']);
  });

  it('puts something you can start above something you cannot', () => {
    // `blocked` unlocks far more, but you cannot begin it — so it is not next.
    const m = map(
      concept('gate'),
      concept('blocked', { prereqs: ['gate'] }),
      concept('b1', { prereqs: ['blocked'] }),
      concept('b2', { prereqs: ['blocked'] }),
      concept('b3', { prereqs: ['blocked'] }),
      concept('ready'),
    );
    const ranked = rankConcepts(m, {});
    expect(ranked[0]!.ready).toBe(true);
    expect(ranked.find((r) => r.concept.id === 'blocked')!.ready).toBe(false);
  });

  it('puts a startable concept above an equally useful blocked one', () => {
    // Neither unlocks anything, so leverage cannot separate them — only being
    // able to begin can. Named so that without that rule the blocked one would
    // win on the alphabetical tie-break.
    const m = map(
      concept('gate', { name: 'Gate' }),
      concept('blocked-thing', { name: 'Blocked', prereqs: ['gate'] }),
      concept('ready-thing', { name: 'Ready' }),
    );
    const ids = rankConcepts(m, {}).map((r) => r.concept.id);
    expect(ids.indexOf('ready-thing')).toBeLessThan(ids.indexOf('blocked-thing'));
  });

  it('says which prerequisites are missing', () => {
    const m = map(
      concept('needA', { name: 'A' }),
      concept('needB', { name: 'B' }),
      concept('target', { prereqs: ['needA', 'needB'] }),
    );
    const target = rankConcepts(m, {}).find((r) => r.concept.id === 'target')!;
    expect(target.missing).toEqual(['A', 'B']);
  });

  it('counts a hub as ready once its own prerequisite is known', () => {
    const m = map(
      concept('gate', { sessionIds: ['s1'] }),
      concept('hub', { prereqs: ['gate'] }),
      concept('x', { prereqs: ['hub'] }),
      concept('y', { prereqs: ['hub'] }),
    );
    const ranked = rankConcepts(m, { s1: done });
    expect(ranked[0]!.concept.id).toBe('hub');
    expect(ranked[0]!.unlocks).toBe(2);
  });

  it('does not credit a hub for unlocking things already known', () => {
    // The whole point of ranking by leverage rather than by edge count: this
    // hub has three dependents and opens nothing.
    const m = map(
      concept('spent'),
      concept('k1', { prereqs: ['spent'], sessionIds: ['s1'] }),
      concept('k2', { prereqs: ['spent'], sessionIds: ['s2'] }),
      concept('k3', { prereqs: ['spent'], sessionIds: ['s3'] }),
      concept('modest'),
      concept('u1', { prereqs: ['modest'] }),
    );
    const ranked = rankConcepts(m, { s1: done, s2: done, s3: done });
    expect(ranked.find((r) => r.concept.id === 'spent')!.unlocks).toBe(0);
    expect(ranked[0]!.concept.id).toBe('modest');
  });

  it('prefers the better-grounded concept when leverage ties', () => {
    const m = map(
      concept('base1', { sessionIds: ['s1'] }),
      concept('base2', { sessionIds: ['s2'] }),
      concept('grounded', { prereqs: ['base1', 'base2'] }),
      concept('floating'),
    );
    const ranked = rankConcepts(m, { s1: done, s2: done });
    expect(ranked[0]!.concept.id).toBe('grounded');
    expect(ranked[0]!.grounding).toBe(2);
  });

  it('prefers finishing something started over a blank page', () => {
    const m = map(concept('started', { sessionIds: ['s1'] }), concept('fresh'));
    const ranked = rankConcepts(m, { s1: started });
    expect(ranked[0]!.concept.id).toBe('started');
    expect(ranked[0]!.status).toBe('met');
  });

  it('ignores a prerequisite that names a concept which does not exist', () => {
    // One bad id from the model must not make a concept permanently
    // unreachable.
    const m = map(concept('target', { prereqs: ['ghost'] }));
    const ranked = rankConcepts(m, {});
    expect(ranked[0]!.ready).toBe(true);
    expect(ranked[0]!.missing).toEqual([]);
  });

  it('is stable across calls', () => {
    const m = map(concept('b'), concept('a'), concept('c'));
    const once = rankConcepts(m, {}).map((r) => r.concept.id);
    expect(rankConcepts(m, {}).map((r) => r.concept.id)).toEqual(once);
    expect(once).toEqual(['a', 'b', 'c']);
  });

  it('handles an empty map', () => {
    expect(rankConcepts(map(), {})).toEqual([]);
  });
});
