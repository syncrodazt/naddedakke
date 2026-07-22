import { describe, expect, it } from 'vitest';
import { sortedBySeq, visibleGraph } from './visibility';
import type { REdge, RNode } from '../model/types';

function node(id: string, seq: number): RNode {
  return {
    id,
    sessionId: 's',
    kind: 'chunk',
    seq,
    position: { x: 0, y: 0 },
    content: { md: '', highlights: [] },
  };
}

function edge(id: string, source: string, target: string): REdge {
  return { id, sessionId: 's', kind: 'next', source, target };
}

const nodes = {
  a: node('a', 1),
  c: node('c', 3),
  b: node('b', 2),
};
const edges = {
  e1: edge('e1', 'a', 'b'),
  e2: edge('e2', 'b', 'c'),
};

describe('replay visibility', () => {
  it('sorts nodes by seq regardless of insertion order', () => {
    expect(sortedBySeq(nodes).map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('reveals nodes cumulatively in seq order', () => {
    expect([...visibleGraph(nodes, edges, 0).nodeIds]).toEqual([]);
    expect([...visibleGraph(nodes, edges, 1).nodeIds]).toEqual(['a']);
    expect([...visibleGraph(nodes, edges, 2).nodeIds].sort()).toEqual(['a', 'b']);
    expect(visibleGraph(nodes, edges, 99).nodeIds.size).toBe(3);
  });

  it('draws an edge only once both endpoints are visible', () => {
    expect(visibleGraph(nodes, edges, 1).edgeIds.size).toBe(0);
    expect([...visibleGraph(nodes, edges, 2).edgeIds]).toEqual(['e1']);
    expect(visibleGraph(nodes, edges, 3).edgeIds.size).toBe(2);
  });
});
