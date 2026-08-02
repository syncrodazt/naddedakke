import { describe, expect, it } from 'vitest';
import type { RNode } from '../model/types';
import { LessonPlanError, MAX_STEPS, nextPlanStep, parsePlan, taughtSteps } from './plan';

const six = (extra: unknown[] = []) => [
  ...Array.from({ length: 6 }, (_, i) => ({ title: `Step ${i + 1}`, gist: `does ${i + 1}` })),
  ...extra,
];

describe('parsePlan', () => {
  it('reads the steps in the order the model gave them', () => {
    // Order IS the plan: each step may only depend on the ones before it.
    const steps = parsePlan(JSON.stringify({ steps: six() }));
    expect(steps.map((s) => s.title)).toEqual([
      'Step 1',
      'Step 2',
      'Step 3',
      'Step 4',
      'Step 5',
      'Step 6',
    ]);
    expect(steps[0]).toEqual({ title: 'Step 1', gist: 'does 1' });
  });

  it('unwraps a fenced block', () => {
    const raw = '```json\n' + JSON.stringify({ steps: six() }) + '\n```';
    expect(parsePlan(raw)).toHaveLength(6);
  });

  it('trims whitespace off titles and gists', () => {
    const steps = parsePlan(JSON.stringify({ steps: six([{ title: '  Last  ', gist: ' g ' }]) }));
    expect(steps[6]).toEqual({ title: 'Last', gist: 'g' });
  });

  it('drops a step with no title rather than showing a blank row', () => {
    // The whole value of the panel is that the list can be read.
    const steps = parsePlan(JSON.stringify({ steps: six([{ title: '   ', gist: 'orphan' }]) }));
    expect(steps).toHaveLength(6);
  });

  it('keeps a step whose gist is missing', () => {
    // A title alone still tells the learner what is coming; refusing the whole
    // plan over a missing subtitle would be worse than showing it bare.
    const steps = parsePlan(JSON.stringify({ steps: six([{ title: 'Bare' }]) }));
    expect(steps[6]).toEqual({ title: 'Bare', gist: '' });
  });

  it('recovers the steps that arrived when the reply was cut short', () => {
    // A reply that runs out of budget stops mid-object. Nine steps that made it
    // beat an error message.
    const full = JSON.stringify({ steps: six([{ title: 'Seven', gist: 'g7' }]) });
    const truncated = full.slice(0, full.length - 12);
    const steps = parsePlan(truncated);
    expect(steps.length).toBeGreaterThanOrEqual(6);
    expect(steps[0]!.title).toBe('Step 1');
  });

  it('is not fooled by a brace inside a gist', () => {
    const steps = parsePlan(
      JSON.stringify({ steps: six([{ title: 'Braces', gist: 'the set {a, b}' }]) }) +
        'trailing junk',
    );
    expect(steps[6]).toEqual({ title: 'Braces', gist: 'the set {a, b}' });
  });

  it('caps a runaway plan', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ title: `S${i}`, gist: '' }));
    expect(parsePlan(JSON.stringify({ steps: many }))).toHaveLength(MAX_STEPS);
  });

  it('refuses a plan too short to be one', () => {
    // Two steps is not a route through a topic; teaching against it would be
    // worse than teaching with no plan at all.
    expect(() => parsePlan(JSON.stringify({ steps: [{ title: 'a', gist: '' }] }))).toThrow(
      LessonPlanError,
    );
  });

  it('says what actually came back when there is nothing usable', () => {
    // "Not JSON" reads the same for an empty reply, an error page and a chatty
    // model, and those need different things done about them.
    expect(() => parsePlan('')).toThrow(/empty reply/);
    expect(() => parsePlan('Sure! I can help with that.')).toThrow(/Sure! I can help/);
    expect(() => parsePlan(JSON.stringify({ nope: [] }))).toThrow(/"steps"/);
  });
});

function chunk(id: string, seq: number, planStep?: number): RNode {
  return {
    id,
    sessionId: 's',
    kind: 'chunk',
    seq,
    position: { x: 0, y: 0 },
    content: { md: '', highlights: [] },
    ...(planStep === undefined ? {} : { planStep }),
  };
}

function graph(...nodes: RNode[]): Record<string, RNode> {
  return Object.fromEntries(nodes.map((n) => [n.id, n]));
}

const OUTLINE = Array.from({ length: 4 }, (_, i) => ({ title: `s${i}`, gist: '' }));

describe('taughtSteps', () => {
  it('reports which plan steps have a chunk', () => {
    expect([...taughtSteps(graph(chunk('a', 1, 0), chunk('b', 2, 2)))].sort()).toEqual([0, 2]);
  });

  it('ignores a chunk that is not part of the plan', () => {
    // A prerequisite spliced in because the learner got lost is real work, but
    // counting it as a promised step would make the progress figure a lie.
    expect(taughtSteps(graph(chunk('a', 1, 0), chunk('pre', 2))).size).toBe(1);
  });

  it('ignores nodes that are not chunks', () => {
    const question: RNode = { ...chunk('q', 3, 1), kind: 'question' };
    expect([...taughtSteps(graph(chunk('a', 1, 0), question))]).toEqual([0]);
  });
});

describe('nextPlanStep', () => {
  it('is the first step with nothing written for it', () => {
    expect(nextPlanStep(graph(chunk('a', 1, 0), chunk('b', 2, 1)), OUTLINE)).toBe(2);
  });

  it('starts at the beginning when nothing has been taught', () => {
    expect(nextPlanStep({}, OUTLINE)).toBe(0);
  });

  it('fills a hole rather than carrying on past it', () => {
    // A deleted chunk leaves its step untaught. The lesson owes that step, and
    // counting chunks instead of reading them would silently skip it.
    expect(nextPlanStep(graph(chunk('a', 1, 0), chunk('c', 3, 2)), OUTLINE)).toBe(1);
  });

  it('is null once every step has been written', () => {
    const all = graph(...OUTLINE.map((_, i) => chunk(`c${i}`, i + 1, i)));
    expect(nextPlanStep(all, OUTLINE)).toBeNull();
  });

  it('is null for an empty plan', () => {
    expect(nextPlanStep({}, [])).toBeNull();
  });
});
