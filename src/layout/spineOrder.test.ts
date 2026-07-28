import { describe, expect, it } from 'vitest';
import type { REdge, RNode } from '../model/types';
import { computeLayout, spineOrder } from './layout';

function node(id: string, seq: number): RNode {
  return {
    id,
    sessionId: 's',
    kind: 'chunk',
    seq,
    position: { x: 0, y: 0 },
    content: { md: id, highlights: [] },
  };
}

const next = (id: string, source: string, target: string): REdge => ({
  id,
  sessionId: 's',
  kind: 'next',
  source,
  target,
});

describe('spineOrder', () => {
  it('follows the chain, not seq, once a prerequisite is spliced in', () => {
    // The whole point: `pre` was created last (seq 3) but belongs before `b`.
    // Ordering by seq would put it on the far right of the canvas.
    const nodes = [node('a', 1), node('b', 2), node('pre', 3)];
    const edges = [next('e1', 'a', 'pre'), next('e2', 'pre', 'b')];
    expect(spineOrder(nodes, edges).map((n) => n.id)).toEqual(['a', 'pre', 'b']);
  });

  it('keeps plain appended chunks in order', () => {
    const nodes = [node('a', 1), node('b', 2), node('c', 3)];
    const edges = [next('e1', 'a', 'b'), next('e2', 'b', 'c')];
    expect(spineOrder(nodes, edges).map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('falls back to seq for nodes no chain touches', () => {
    const nodes = [node('a', 1), node('b', 2), node('loose', 3)];
    expect(spineOrder(nodes, [next('e1', 'a', 'b')]).map((n) => n.id)).toEqual(['a', 'b', 'loose']);
  });

  it('places every node exactly once, even with a broken chain', () => {
    // A cycle would otherwise loop forever, and a duplicate would draw a node
    // twice; neither should be possible, but the layout must not hang if it is.
    const nodes = [node('a', 1), node('b', 2)];
    const edges = [next('e1', 'a', 'b'), next('e2', 'b', 'a')];
    const out = spineOrder(nodes, edges);
    expect(out).toHaveLength(2);
    expect(new Set(out.map((n) => n.id)).size).toBe(2);
  });
});

describe('computeLayout follows the chain', () => {
  it('draws a spliced prerequisite to the left of what it precedes', () => {
    // Testing spineOrder alone proves nothing about the canvas: the layout has
    // to actually consult it. Ordering roots by seq here would put the
    // prerequisite on the far right, which is what this catches.
    const nodes = { a: node('a', 1), b: node('b', 2), pre: node('pre', 3) };
    const edges = { e1: next('e1', 'a', 'pre'), e2: next('e2', 'pre', 'b') };
    const pos = computeLayout(nodes, edges);
    expect(pos.a!.x).toBeLessThan(pos.pre!.x);
    expect(pos.pre!.x).toBeLessThan(pos.b!.x);
  });
});
