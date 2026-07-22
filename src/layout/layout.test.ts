import { describe, expect, it } from 'vitest';
import {
  BRANCH_INDENT_X,
  SPINE_Y,
  branchDepth,
  branchPosition,
  computeLayout,
  spinePosition,
  whySiblingCount,
} from './layout';
import type { REdge, RNode } from '../model/types';

function node(id: string, kind: RNode['kind'], x = 0, y = 0, seq = 0): RNode {
  return {
    id,
    sessionId: 's',
    kind,
    seq,
    position: { x, y },
    content: { md: '', highlights: [] },
  };
}

function byId(list: RNode[]): Record<string, RNode> {
  return Object.fromEntries(list.map((n) => [n.id, n]));
}
function edgesById(list: REdge[]): Record<string, REdge> {
  return Object.fromEntries(list.map((e) => [e.id, e]));
}

function edge(id: string, kind: REdge['kind'], source: string, target: string): REdge {
  return { id, sessionId: 's', kind, source, target };
}

describe('layout', () => {
  it('places spine chunks left to right at a fixed y', () => {
    const positions = [0, 1, 2, 3].map(spinePosition);
    expect(positions.every((p) => p.y === SPINE_Y)).toBe(true);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]!.x).toBeGreaterThan(positions[i - 1]!.x);
    }
  });

  it('computes branch depth by counting why edges up to the spine', () => {
    const edges = {
      e1: edge('e1', 'why', 'chunk', 'q1'),
      e2: edge('e2', 'reply', 'q1', 'a1'),
      e3: edge('e3', 'why', 'a1', 'q2'),
      e4: edge('e4', 'reply', 'q2', 'a2'),
    };
    expect(branchDepth('chunk', edges)).toBe(0);
    expect(branchDepth('a1', edges)).toBe(1);
    expect(branchDepth('a2', edges)).toBe(2);
  });

  it('indents deeper branches and keeps them below their parent', () => {
    const parent = node('p', 'chunk', 480, 0);
    const depth1 = branchPosition(parent, 1, 0);
    const depth2 = branchPosition(parent, 2, 0);
    expect(depth1.y).toBeGreaterThan(parent.position.y);
    expect(depth1.x).toBe(parent.position.x + BRANCH_INDENT_X);
    expect(depth2.x).toBe(parent.position.x + 2 * BRANCH_INDENT_X);
  });

  it('stacks siblings without overlap', () => {
    const parent = node('p', 'chunk');
    const first = branchPosition(parent, 1, 0);
    const second = branchPosition(parent, 1, 1);
    expect(second.x).toBe(first.x);
    expect(second.y).toBeGreaterThan(first.y);
  });

  it('counts only why edges as siblings', () => {
    const edges = {
      e1: edge('e1', 'why', 'p', 'q1'),
      e2: edge('e2', 'why', 'p', 'q2'),
      e3: edge('e3', 'next', 'p', 'c2'),
      e4: edge('e4', 'reply', 'p', 'x'),
    };
    expect(whySiblingCount('p', edges)).toBe(2);
  });
});

describe('computeLayout (tidy)', () => {
  it('lays out the spine left→right by seq at a fixed y', () => {
    const nodes = byId([
      node('c1', 'chunk', 999, 999, 1),
      node('c2', 'chunk', 5, 5, 2),
      node('c3', 'chunk', 0, 0, 3),
    ]);
    const edges = edgesById([edge('e1', 'next', 'c1', 'c2'), edge('e2', 'next', 'c2', 'c3')]);
    const p = computeLayout(nodes, edges);
    expect(p.c1.y).toBe(SPINE_Y);
    expect(p.c2.x).toBeGreaterThan(p.c1.x);
    expect(p.c3.x).toBeGreaterThan(p.c2.x);
    expect([p.c1.y, p.c2.y, p.c3.y]).toEqual([SPINE_Y, SPINE_Y, SPINE_Y]);
  });

  it('packs a branch subtree below its spine node with no two nodes overlapping', () => {
    // c1 → (why) q1 → (reply) a1 → (why) q2 → (reply) a2, plus a sibling why q3
    const nodes = byId([
      node('c1', 'chunk', 0, 0, 1),
      node('q1', 'question', 0, 0, 2),
      node('a1', 'answer', 0, 0, 3),
      node('q2', 'question', 0, 0, 4),
      node('a2', 'answer', 0, 0, 5),
      node('q3', 'question', 0, 0, 6),
    ]);
    const edges = edgesById([
      edge('e1', 'why', 'c1', 'q1'),
      edge('e2', 'reply', 'q1', 'a1'),
      edge('e3', 'why', 'a1', 'q2'),
      edge('e4', 'reply', 'q2', 'a2'),
      edge('e5', 'why', 'c1', 'q3'),
    ]);
    const p = computeLayout(nodes, edges);
    // every branch node sits below the spine and at a distinct y (no overlap)
    const ys = ['q1', 'a1', 'q2', 'a2', 'q3'].map((id) => p[id].y);
    expect(new Set(ys).size).toBe(ys.length);
    expect(Math.min(...ys)).toBeGreaterThan(p.c1.y);
    // 'why' indents one step deeper; 'reply' keeps the question's indent
    expect(p.q1.x).toBe(p.c1.x + BRANCH_INDENT_X);
    expect(p.a1.x).toBe(p.q1.x); // reply, same indent
    expect(p.q2.x).toBe(p.a1.x + BRANCH_INDENT_X); // deeper why
    expect(p.q3.x).toBe(p.c1.x + BRANCH_INDENT_X); // sibling of q1
  });
});
