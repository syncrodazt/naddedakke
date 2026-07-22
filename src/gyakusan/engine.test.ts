import { describe, expect, it } from 'vitest';
import { CYCLE_ISSUE, recomputeGraph } from './engine';
import { fireFixture } from './fireFixture';
import type { REdge, RNode } from '../model/types';

function variable(id: string, value: number): RNode {
  return {
    id,
    sessionId: 's',
    kind: 'variable',
    seq: 0,
    position: { x: 0, y: 0 },
    content: { md: '', highlights: [] },
    value,
  };
}

function derived(id: string, formula: string): RNode {
  return {
    id,
    sessionId: 's',
    kind: 'derived',
    seq: 0,
    position: { x: 0, y: 0 },
    content: { md: '', highlights: [] },
    formula,
  };
}

function dep(id: string, source: string, target: string): REdge {
  return { id, sessionId: 's', kind: 'depends', source, target };
}

function byId(list: RNode[]): Record<string, RNode> {
  return Object.fromEntries(list.map((n) => [n.id, n]));
}

function edgesById(list: REdge[]): Record<string, REdge> {
  return Object.fromEntries(list.map((e) => [e.id, e]));
}

describe('gyakusan recompute', () => {
  it('evaluates a chain in topological order regardless of declaration order', () => {
    const nodes = byId([
      derived('d', 'c * 2'),
      derived('c', 'a + b'),
      variable('a', 2),
      variable('b', 3),
    ]);
    const edges = edgesById([dep('e1', 'a', 'c'), dep('e2', 'b', 'c'), dep('e3', 'c', 'd')]);
    const { values, issues } = recomputeGraph(nodes, edges);
    expect(issues).toEqual({});
    expect(values.c).toBe(5);
    expect(values.d).toBe(10);
  });

  it('propagates a variable change downstream', () => {
    const nodes = byId([
      variable('a', 2),
      variable('b', 3),
      derived('c', 'a + b'),
      derived('d', 'c * 2'),
    ]);
    const edges = edgesById([dep('e1', 'a', 'c'), dep('e2', 'b', 'c'), dep('e3', 'c', 'd')]);
    nodes.a = { ...nodes.a!, value: 10 };
    const { values } = recomputeGraph(nodes, edges);
    expect(values.c).toBe(13);
    expect(values.d).toBe(26);
  });

  it('rejects cycles with per-node issues instead of crashing', () => {
    const nodes = byId([
      derived('x', 'y + 1'),
      derived('y', 'x + 1'),
      variable('a', 1),
      derived('ok', 'a * 2'),
    ]);
    const edges = edgesById([dep('e1', 'y', 'x'), dep('e2', 'x', 'y'), dep('e3', 'a', 'ok')]);
    const { values, issues } = recomputeGraph(nodes, edges);
    expect(issues.x).toBe(CYCLE_ISSUE);
    expect(issues.y).toBe(CYCLE_ISSUE);
    expect(values.ok).toBe(2); // the rest of the graph still computes
    expect(values.x).toBeUndefined();
  });

  it('records evaluation errors without crashing the rest', () => {
    const nodes = byId([variable('a', 1), derived('bad', 'a +'), derived('good', 'a * 3')]);
    const edges = edgesById([dep('e1', 'a', 'bad'), dep('e2', 'a', 'good')]);
    const { values, issues } = recomputeGraph(nodes, edges);
    expect(issues.bad).toBeTruthy();
    expect(values.good).toBe(3);
  });

  it('computes the FIRE fixture end to end', () => {
    const nodes = Object.fromEntries(fireFixture.nodes.map((n) => [n.id, n]));
    const edges = Object.fromEntries(fireFixture.edges.map((e) => [e.id, e]));
    const { values, issues } = recomputeGraph(nodes, edges);
    expect(issues).toEqual({});
    expect(values.years_left).toBe(7);
    expect(values.required_portfolio).toBe(7500);
    expect(values.future_net_worth).toBeCloseTo(300 * Math.pow(1.04, 7), 6);
    expect(values.required_monthly).toBeGreaterThan(50);
    expect(values.required_monthly).toBeLessThan(100);
  });
});
