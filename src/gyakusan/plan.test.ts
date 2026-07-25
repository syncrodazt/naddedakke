import { describe, expect, it } from 'vitest';
import { extractJson, formulaSymbols, parseGoalPlan, planToSession } from './plan';
import { recomputeGraph } from './engine';

const GOOD = {
  title: 'FIRE by 40',
  goalLabel: 'Monthly saving needed',
  goalNote: 'Rough estimate.',
  variables: [
    { name: 'target', label: 'Target', value: 1000, unit: 'k', min: 100, max: 5000, step: 100 },
    { name: 'years', label: 'Years', value: 10, unit: 'y', min: 1, max: 40, step: 1 },
  ],
  derived: [
    { name: 'months', label: 'Months', formula: 'years * 12', unit: 'mo' },
    { name: 'per_month', label: 'Per month', formula: 'target / months', unit: 'k' },
  ],
  goalOf: 'per_month',
};

const json = (o: unknown) => JSON.stringify(o);

describe('extractJson', () => {
  it('unwraps a fenced block', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('finds the object when the model adds chatter around it', () => {
    expect(extractJson('Sure! {"a":1} hope that helps')).toBe('{"a":1}');
  });

  it('rejects a reply with no object at all', () => {
    expect(() => extractJson('I cannot help with that')).toThrow(/JSON object/);
  });
});

describe('formulaSymbols', () => {
  it('collects value references', () => {
    expect(formulaSymbols('a + b * 2', 'f').sort()).toEqual(['a', 'b']);
  });

  it('does not mistake a function name for a dependency', () => {
    expect(formulaSymbols('max(0, a - b)', 'f').sort()).toEqual(['a', 'b']);
  });
});

describe('parseGoalPlan', () => {
  it('accepts a well-formed plan', () => {
    const plan = parseGoalPlan(json(GOOD));
    expect(plan.variables).toHaveLength(2);
    expect(plan.derived.map((d) => d.name)).toEqual(['months', 'per_month']);
    expect(plan.goalOf).toBe('per_month');
  });

  it('rejects a formula referencing a name the plan never defines', () => {
    const bad = { ...GOOD, derived: [{ ...GOOD.derived[0]!, formula: 'years * inflation' }] };
    expect(() => parseGoalPlan(json({ ...bad, goalOf: 'months' }))).toThrow(/unknown "inflation"/);
  });

  it('rejects a circular set of formulas', () => {
    const bad = {
      ...GOOD,
      derived: [
        { name: 'a', label: 'A', formula: 'b + 1', unit: '' },
        { name: 'b', label: 'B', formula: 'a + 1', unit: '' },
      ],
      goalOf: 'a',
    };
    expect(() => parseGoalPlan(json(bad))).toThrow(/circular/);
  });

  it('rejects a self-referencing formula', () => {
    const bad = {
      ...GOOD,
      derived: [{ name: 'a', label: 'A', formula: 'a + 1', unit: '' }],
      goalOf: 'a',
    };
    expect(() => parseGoalPlan(json(bad))).toThrow(/refers to itself/);
  });

  it('rejects names that are not valid identifiers', () => {
    const bad = { ...GOOD, variables: [{ ...GOOD.variables[0]!, name: 'target amount' }] };
    expect(() => parseGoalPlan(json(bad))).toThrow(/not a valid identifier/);
  });

  it('rejects duplicate names', () => {
    const bad = {
      ...GOOD,
      variables: [GOOD.variables[0]!, { ...GOOD.variables[1]!, name: 'target' }],
    };
    expect(() => parseGoalPlan(json(bad))).toThrow(/duplicate name/);
  });

  it('rejects a goalOf that is not one of the derived quantities', () => {
    expect(() => parseGoalPlan(json({ ...GOOD, goalOf: 'nope' }))).toThrow(/goalOf/);
  });

  it('rejects an unparseable formula rather than letting it reach mathjs later', () => {
    const bad = { ...GOOD, derived: [{ ...GOOD.derived[0]!, formula: 'years * * 12' }] };
    expect(() => parseGoalPlan(json({ ...bad, goalOf: 'months' }))).toThrow(/cannot parse/);
  });

  it('widens a slider range that would exclude its own starting value', () => {
    const odd = {
      ...GOOD,
      variables: [{ ...GOOD.variables[0]!, value: 9000, min: 100, max: 5000 }, GOOD.variables[1]!],
    };
    const plan = parseGoalPlan(json(odd));
    const v = plan.variables[0]!;
    expect(v.min).toBeLessThanOrEqual(v.value);
    expect(v.max).toBeGreaterThanOrEqual(v.value);
  });
});

describe('planToSession', () => {
  it('builds a gyakusan session whose formulas actually evaluate', () => {
    const exp = planToSession(parseGoalPlan(json(GOOD)), 'disclaimer');
    expect(exp.session.mode).toBe('gyakusan');

    const nodes = Object.fromEntries(exp.nodes.map((n) => [n.id, n]));
    const edges = Object.fromEntries(exp.edges.map((e) => [e.id, e]));
    const { values, issues } = recomputeGraph(nodes, edges);

    expect(issues).toEqual({});
    const goalNode = exp.nodes.find((n) => n.kind === 'goal')!;
    // target 1000 / (10 years * 12) = 8.33…
    expect(values[goalNode.id]).toBeCloseTo(1000 / 120, 6);
  });

  it('keeps formula names off the node ids, so two plans can share a name', () => {
    const a = planToSession(parseGoalPlan(json(GOOD)), 'd');
    const b = planToSession(parseGoalPlan(json(GOOD)), 'd');
    const idsA = new Set(a.nodes.map((n) => n.id));
    // Same readable names on both sides...
    expect(a.nodes.map((n) => n.varName)).toEqual(b.nodes.map((n) => n.varName));
    // ...but no id collision, so one cannot overwrite the other in the database.
    expect(b.nodes.some((n) => idsA.has(n.id))).toBe(false);
  });

  it('wires a depends edge for every value a formula reads', () => {
    const exp = planToSession(parseGoalPlan(json(GOOD)), 'd');
    const byName = Object.fromEntries(exp.nodes.map((n) => [n.varName, n.id]));
    const has = (from: string, to: string) =>
      exp.edges.some(
        (e) => e.kind === 'depends' && e.source === byName[from] && e.target === byName[to],
      );
    expect(has('years', 'months')).toBe(true);
    expect(has('target', 'per_month')).toBe(true);
    expect(has('months', 'per_month')).toBe(true);
  });

  it('includes the educational-model disclaimer', () => {
    const exp = planToSession(parseGoalPlan(json(GOOD)), 'not financial advice');
    expect(exp.nodes.some((n) => n.content.md === 'not financial advice')).toBe(true);
  });

  it('numbers every node with a distinct seq', () => {
    const exp = planToSession(parseGoalPlan(json(GOOD)), 'd');
    const seqs = exp.nodes.map((n) => n.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(exp.session.seqCounter).toBe(Math.max(...seqs));
  });
});
