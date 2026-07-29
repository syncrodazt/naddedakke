import { describe, expect, it } from 'vitest';
import type { REdge, RNode } from '../model/types';
import { computeLayout, type NodeMetrics } from './layout';

const node = (id: string, seq: number, kind: RNode['kind'] = 'chunk'): RNode => ({
  id,
  sessionId: 's',
  kind,
  seq,
  position: { x: 0, y: 0 },
  content: { md: id, highlights: [] },
});

const edge = (id: string, kind: REdge['kind'], source: string, target: string): REdge => ({
  id,
  sessionId: 's',
  kind,
  source,
  target,
});

/** Two spine chunks, one with a why-branch and its answer. */
const NODES: Record<string, RNode> = {
  c1: node('c1', 1),
  q1: node('q1', 2, 'question'),
  a1: node('a1', 3, 'answer'),
  c2: node('c2', 4),
};
const EDGES: Record<string, REdge> = {
  e1: edge('e1', 'next', 'c1', 'c2'),
  e2: edge('e2', 'why', 'c1', 'q1'),
  e3: edge('e3', 'reply', 'q1', 'a1'),
};

// Deliberately not square: transposing finished positions would collapse.
const CARD = { width: 360, height: 900 };

/** Every node reports the same non-square size, so the checks below are exact. */
function metricsFor(nodes: Record<string, RNode>): NodeMetrics {
  return Object.fromEntries(Object.keys(nodes).map((id) => [id, CARD]));
}

const METRICS = metricsFor(NODES);

function rects(pos: Record<string, { x: number; y: number }>) {
  return Object.entries(pos).map(([id, p]) => ({ id, ...p, ...CARD }));
}

function overlaps(pos: Record<string, { x: number; y: number }>): string[] {
  const rs = rects(pos);
  const out: string[] = [];
  for (const a of rs) {
    for (const b of rs) {
      if (a.id >= b.id) continue;
      if (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
      )
        out.push(`${a.id}/${b.id}`);
    }
  }
  return out;
}

describe('horizontal', () => {
  const pos = computeLayout(NODES, EDGES, METRICS, 'horizontal');

  it('runs the spine left to right', () => {
    expect(pos.c2!.x).toBeGreaterThan(pos.c1!.x);
    expect(pos.c2!.y).toBe(pos.c1!.y);
  });

  it('hangs branches below their parent', () => {
    expect(pos.q1!.y).toBeGreaterThan(pos.c1!.y);
  });

  it('overlaps nothing', () => {
    expect(overlaps(pos)).toEqual([]);
  });
});

describe('vertical', () => {
  const pos = computeLayout(NODES, EDGES, METRICS, 'vertical');

  it('runs the spine top to bottom', () => {
    expect(pos.c2!.y).toBeGreaterThan(pos.c1!.y);
    expect(pos.c2!.x).toBe(pos.c1!.x);
  });

  it('puts branches to the side instead of below', () => {
    expect(pos.q1!.x).toBeGreaterThan(pos.c1!.x);
  });

  it('overlaps nothing either', () => {
    // The real risk: reusing the horizontal packing without swapping which
    // dimension is measured would stack 900px-tall cards 360px apart.
    expect(overlaps(pos)).toEqual([]);
  });

  it('is genuinely a different arrangement, not the same one relabelled', () => {
    const h = computeLayout(NODES, EDGES, METRICS, 'horizontal');
    expect(pos).not.toEqual(h);
  });
});

describe('direction on a back-cast graph', () => {
  const gy: Record<string, RNode> = {
    v1: node('v1', 1, 'variable'),
    v2: node('v2', 2, 'variable'),
    g: node('g', 3, 'goal'),
  };
  const ge: Record<string, REdge> = {
    d1: edge('d1', 'depends', 'v1', 'g'),
    d2: edge('d2', 'depends', 'v2', 'g'),
  };

  const GY_METRICS = metricsFor(gy);

  it('lays dependency layers along the chosen axis', () => {
    const h = computeLayout(gy, ge, GY_METRICS, 'horizontal');
    expect(h.g!.x).toBeGreaterThan(h.v1!.x); // inputs left of the goal
    const v = computeLayout(gy, ge, GY_METRICS, 'vertical');
    expect(v.g!.y).toBeGreaterThan(v.v1!.y); // inputs above the goal
  });

  it('packs a vertical column by card WIDTH, not height', () => {
    // The subtle half of the swap. Stacking sideways but still measuring
    // height leaves 900px gaps between 360px-wide cards: no overlap, so an
    // overlap check misses it entirely, but the result is unreadably sparse.
    const v = computeLayout(gy, ge, GY_METRICS, 'vertical');
    expect(v.v2!.x).toBeGreaterThan(CARD.width - 1);
    expect(v.v2!.x).toBeLessThan(CARD.height);
  });

  it('keeps the layers clear of each other in both', () => {
    expect(overlaps(computeLayout(gy, ge, GY_METRICS, 'horizontal'))).toEqual([]);
    expect(overlaps(computeLayout(gy, ge, GY_METRICS, 'vertical'))).toEqual([]);
  });
});
