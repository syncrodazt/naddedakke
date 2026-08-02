import { describe, expect, it } from 'vitest';
import { MAX_HEADINGS, coverageOf, inventoryFor, summarise } from './inventory';
import type { RNode, Session } from '../model/types';

function session(id: string, title: string): Session {
  return { id, title, mode: 'learn', createdAt: 0, seqCounter: 0 };
}

function node(id: string, over: Partial<RNode> = {}): RNode {
  return {
    id,
    sessionId: 's1',
    kind: 'chunk',
    seq: 1,
    position: { x: 0, y: 0 },
    content: { md: `## ${id}`, highlights: [] },
    ...over,
  };
}

describe('summarise', () => {
  it('lists headings in seq order', () => {
    const nodes = [
      node('c', { seq: 3, content: { md: '## Third', highlights: [] } }),
      node('a', { seq: 1, content: { md: '## First', highlights: [] } }),
      node('b', { seq: 2, content: { md: '## Second', highlights: [] } }),
    ];
    expect(summarise(session('s1', 'T'), nodes).headings).toEqual(['First', 'Second', 'Third']);
  });

  it('leaves out the learner’s own questions', () => {
    // The inventory is what was TAUGHT. A question is what they did not know.
    const nodes = [
      node('a', { content: { md: '## Lesson', highlights: [] } }),
      node('q', { kind: 'question', seq: 2, content: { md: '## Why?', highlights: [] } }),
    ];
    expect(summarise(session('s1', 'T'), nodes).headings).toEqual(['Lesson']);
  });

  it('does not repeat a heading an answer echoes back', () => {
    const nodes = [
      node('a', { content: { md: '## Sampling', highlights: [] } }),
      node('b', { kind: 'answer', seq: 2, content: { md: '## Sampling', highlights: [] } }),
    ];
    expect(summarise(session('s1', 'T'), nodes).headings).toEqual(['Sampling']);
  });

  it('caps how much of one notebook is sent', () => {
    const nodes = Array.from({ length: 40 }, (_, i) =>
      node(`n${i}`, { seq: i, content: { md: `## H${i}`, highlights: [] } }),
    );
    expect(summarise(session('s1', 'T'), nodes).headings).toHaveLength(MAX_HEADINGS);
  });

  it('counts understood against content nodes only', () => {
    const nodes = [
      node('a', { understood: true }),
      node('b', { seq: 2 }),
      node('q', { kind: 'question', seq: 3, understood: true }),
    ];
    const summary = summarise(session('s1', 'T'), nodes);
    expect(summary).toMatchObject({ understood: 1, total: 2 });
  });

  it('handles a notebook with nothing in it', () => {
    expect(summarise(session('s1', 'T'), [])).toMatchObject({
      headings: [],
      understood: 0,
      total: 0,
    });
  });
});

describe('coverageOf / inventoryFor', () => {
  it('keys coverage by notebook', () => {
    const summaries = [
      { id: 's1', title: 'A', headings: [], understood: 2, total: 4 },
      { id: 's2', title: 'B', headings: [], understood: 0, total: 1 },
    ];
    expect(coverageOf(summaries)).toEqual({
      s1: { understood: 2, total: 4 },
      s2: { understood: 0, total: 1 },
    });
  });

  it('does not send empty notebooks to the model', () => {
    const summaries = [
      { id: 's1', title: 'Real', headings: ['x'], understood: 0, total: 3 },
      { id: 's2', title: 'Empty', headings: [], understood: 0, total: 0 },
    ];
    expect(inventoryFor(summaries).map((s) => s.id)).toEqual(['s1']);
  });
});
