import { describe, expect, it } from 'vitest';
import type { RNode } from '../model/types';
import { chunkForStep, planRows } from './progress';

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

const OUTLINE = [
  { title: 'What a wave is', gist: 'so the rest has something to be about' },
  { title: 'Superposition', gist: 'two waves in one place' },
  { title: 'Interference', gist: 'what superposition looks like' },
];

describe('planRows', () => {
  it('shows every step, taught or not', () => {
    // The whole point: you can see there are three steps before step one is
    // written, and read what they are.
    const rows = planRows(OUTLINE, graph(chunk('a', 1, 0)));
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.taught)).toEqual([true, false, false]);
    expect(rows[2]!.title).toBe('Interference');
    expect(rows[2]!.gist).toBe('what superposition looks like');
  });

  it('keeps each row at its plan position, not at its rank among taught steps', () => {
    const rows = planRows(OUTLINE, graph(chunk('c', 1, 2)));
    expect(rows.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(rows[2]!.taught).toBe(true);
    expect(rows[0]!.taught).toBe(false);
  });

  it('does not credit a step to a chunk that is not part of the plan', () => {
    expect(planRows(OUTLINE, graph(chunk('pre', 1))).every((r) => !r.taught)).toBe(true);
  });

  it('is empty when there is no plan', () => {
    expect(planRows([], graph(chunk('a', 1, 0)))).toEqual([]);
  });
});

describe('chunkForStep', () => {
  it('finds the chunk that teaches a step', () => {
    expect(chunkForStep(graph(chunk('a', 1, 0), chunk('b', 2, 1)), 1)).toBe('b');
  });

  it('takes the earliest when a step was taught more than once', () => {
    // Where the step first entered the record is where its branches hang.
    const nodes = graph(chunk('late', 9, 1), chunk('first', 2, 1));
    expect(chunkForStep(nodes, 1)).toBe('first');
  });

  it('is null for a step nothing has been written for', () => {
    expect(chunkForStep(graph(chunk('a', 1, 0)), 2)).toBeNull();
  });
});
