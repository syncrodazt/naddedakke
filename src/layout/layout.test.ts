import { describe, expect, it } from 'vitest';
import {
  BRANCH_INDENT_X,
  SPINE_Y,
  branchDepth,
  branchPosition,
  spinePosition,
  whySiblingCount,
} from './layout';
import type { REdge, RNode } from '../model/types';

function node(id: string, kind: RNode['kind'], x = 0, y = 0): RNode {
  return {
    id,
    sessionId: 's',
    kind,
    seq: 0,
    position: { x, y },
    content: { md: '', highlights: [] },
  };
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
