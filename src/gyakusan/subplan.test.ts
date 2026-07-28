import { describe, expect, it } from 'vitest';
import type { RNode } from '../model/types';
import { applySubPlan, namesInUse } from './subplan';
import { parseGoalPlan, type GoalPlan } from './plan';
import { recomputeGraph } from './engine';

function node(p: Partial<RNode> & { id: string }): RNode {
  return {
    sessionId: 's',
    kind: 'variable',
    seq: 1,
    position: { x: 1000, y: 0 },
    content: { md: '**目標**', highlights: [] },
    ...p,
  } as RNode;
}

/** A canvas with one goal node the learner wants to back-cast. */
function canvas(): Record<string, RNode> {
  return {
    goal: node({ id: 'goal', kind: 'goal', varName: 'monthly_saving', value: 0, seq: 1 }),
  };
}

const PLAN: GoalPlan = {
  title: 'x',
  goalLabel: 'g',
  goalNote: '',
  variables: [
    { name: 'income', label: '年収', value: 500, unit: '万円', min: 0, max: 2000, step: 10 },
    { name: 'rate', label: '貯蓄率', value: 0.3, unit: '', min: 0, max: 1, step: 0.01 },
  ],
  derived: [
    { name: 'yearly', label: '年間貯蓄', formula: 'income * rate', unit: '万円' },
    { name: 'monthly_saving', label: '毎月', formula: 'yearly / 12', unit: '万円/月' },
  ],
  goalOf: 'monthly_saving',
};

let counter = 100;
const nextSeq = () => ++counter;

describe('applySubPlan', () => {
  it('gives the target the goal formula instead of creating a second goal node', () => {
    // The learner pointed at a node that is already on the canvas; duplicating
    // it would leave two nodes claiming to be the same quantity.
    const { nodes } = applySubPlan(canvas(), 'goal', PLAN, 's', nextSeq);
    const target = nodes.find((n) => n.id === 'goal')!;
    expect(target.formula).toBe('yearly / 12');
    expect(nodes.filter((n) => n.varName === 'monthly_saving')).toHaveLength(1);
  });

  it('adds the inputs upstream — to the left of what they feed', () => {
    const { nodes } = applySubPlan(canvas(), 'goal', PLAN, 's', nextSeq);
    const target = nodes.find((n) => n.id === 'goal')!;
    for (const added of nodes.filter((n) => n.id !== 'goal')) {
      expect(added.position.x, added.varName).toBeLessThan(target.position.x);
    }
  });

  it('wires depends edges from what the formulas actually read', () => {
    const { nodes, edges } = applySubPlan(canvas(), 'goal', PLAN, 's', nextSeq);
    const idOf = (name: string) => nodes.find((n) => n.varName === name)!.id;
    const pairs = edges.map((e) => [e.source, e.target]);
    expect(edges.every((e) => e.kind === 'depends')).toBe(true);
    expect(pairs).toContainEqual([idOf('income'), idOf('yearly')]);
    expect(pairs).toContainEqual([idOf('rate'), idOf('yearly')]);
    expect(pairs).toContainEqual([idOf('yearly'), 'goal']);
  });

  it('produces a graph the dataflow engine can actually evaluate', () => {
    // The point of the feature is a live number, not a picture of one.
    const { nodes, edges } = applySubPlan(canvas(), 'goal', PLAN, 's', nextSeq);
    const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const edgeMap = Object.fromEntries(edges.map((e) => [e.id, e]));
    const { values, issues } = recomputeGraph(nodeMap, edgeMap);
    expect(issues).toEqual({});
    expect(values.goal).toBeCloseTo((500 * 0.3) / 12);
  });

  it('takes seq from the caller and never invents one', () => {
    const before = counter;
    const { nodes } = applySubPlan(canvas(), 'goal', PLAN, 's', nextSeq);
    const added = nodes.filter((n) => n.id !== 'goal');
    expect(added.map((n) => n.seq)).toEqual(added.map((_, i) => before + 1 + i));
  });

  it('stops the target behaving like a draggable input once it is computed', () => {
    const withSlider = {
      goal: node({
        id: 'goal',
        kind: 'variable',
        value: 5,
        varInput: { min: 0, max: 10, step: 1 },
      }),
    };
    const { nodes } = applySubPlan(withSlider, 'goal', PLAN, 's', nextSeq);
    const target = nodes.find((n) => n.id === 'goal')!;
    expect(target.varInput).toBeUndefined();
    expect(target.kind).toBe('derived');
  });

  it('reuses a quantity already on the canvas rather than duplicating it', () => {
    const existing = {
      ...canvas(),
      inc: node({ id: 'inc', varName: 'income', value: 800, seq: 2, position: { x: 0, y: 0 } }),
    };
    const { nodes } = applySubPlan(existing, 'goal', PLAN, 's', nextSeq);
    expect(nodes.filter((n) => n.varName === 'income')).toHaveLength(0); // not re-added
    const idOf = (name: string) => nodes.find((n) => n.varName === name)?.id;
    expect(idOf('yearly')).toBeDefined();
  });
});

describe('parseGoalPlan with names already on the canvas', () => {
  const raw = (extra: object) =>
    JSON.stringify({
      title: 't',
      goalLabel: 'g',
      goalNote: '',
      variables: [{ name: 'rate', label: 'r', value: 1, unit: '', min: 0, max: 2, step: 1 }],
      derived: [{ name: 'out', label: 'o', formula: 'income * rate', unit: '', note: '' }],
      goalOf: 'out',
      ...extra,
    });

  it('lets a formula reference an existing quantity', () => {
    expect(parseGoalPlan(raw({}), new Set(['income'])).derived[0]!.formula).toBe('income * rate');
  });

  it('still rejects a name that exists nowhere', () => {
    expect(() => parseGoalPlan(raw({}), new Set())).toThrow(/unknown "income"/);
  });

  it('refuses to redefine something already on the canvas', () => {
    // Redefining would silently detach the learner's existing node from the
    // graph it belongs to.
    const clash = raw({
      variables: [{ name: 'income', label: 'i', value: 1, unit: '', min: 0, max: 2, step: 1 }],
    });
    expect(() => parseGoalPlan(clash, new Set(['income']))).toThrow(/already exists on the canvas/);
  });
});

describe('namesInUse', () => {
  it('lists the names formulas can reference', () => {
    const names = namesInUse({
      a: node({ id: 'a', varName: 'income', value: 1 }),
      b: node({ id: 'b', kind: 'derived', varName: 'out', formula: 'income' }),
      c: node({ id: 'c', kind: 'chunk', content: { md: 'prose', highlights: [] } }),
    });
    // A prose chunk has no value and no formula, so it is not a quantity.
    expect([...names.keys()].sort()).toEqual(['income', 'out']);
  });
});
