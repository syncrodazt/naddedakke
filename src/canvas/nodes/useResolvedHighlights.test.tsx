import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Highlight, RNode } from '../../model/types';
import { useGraphStore } from '../../store/graphStore';
import { useResolvedHighlights } from './useResolvedHighlights';

function node(id: string, understood?: boolean): RNode {
  return {
    id,
    sessionId: 's',
    kind: 'question',
    seq: 1,
    position: { x: 0, y: 0 },
    content: { md: 'q', highlights: [] },
    ...(understood !== undefined ? { understood } : {}),
  };
}

const highlights: Highlight[] = [
  { id: 'h1', start: 0, end: 1, text: 'a', childNodeId: 'q1' },
  { id: 'h2', start: 2, end: 3, text: 'b', childNodeId: 'q2' },
  { id: 'h3', start: 4, end: 5, text: 'c' }, // never branched
];

beforeEach(() => {
  useGraphStore.setState({
    nodes: { q1: node('q1', true), q2: node('q2', false) },
  });
});

describe('useResolvedHighlights', () => {
  it('returns only highlights whose question was marked understood', () => {
    const { result } = renderHook(() => useResolvedHighlights(highlights));
    expect(result.current).toEqual(['h1']);
  });

  it('reacts when a question becomes understood', () => {
    const { result } = renderHook(() => useResolvedHighlights(highlights));
    act(() => {
      useGraphStore.setState({ nodes: { q1: node('q1', true), q2: node('q2', true) } });
    });
    expect(result.current).toEqual(['h1', 'h2']);
  });

  it('keeps the same array across unrelated store writes', () => {
    // This is the performance contract, not a nicety: a fresh array here breaks
    // MarkdownContent's memo, and dragging one node then re-parses the markdown
    // and KaTeX of every node on screen. That cost 780ms frames at 240 nodes.
    const { result } = renderHook(() => useResolvedHighlights(highlights));
    const before = result.current;
    act(() => {
      // A drag: the node map is replaced, but no resolution changed.
      useGraphStore.setState({
        nodes: { q1: node('q1', true), q2: node('q2', false), other: node('other') },
      });
    });
    expect(result.current).toBe(before);
  });

  it('returns a stable empty array when nothing is resolved', () => {
    useGraphStore.setState({ nodes: { q1: node('q1', false), q2: node('q2', false) } });
    const { result } = renderHook(() => useResolvedHighlights(highlights));
    const before = result.current;
    expect(before).toEqual([]);
    act(() => {
      useGraphStore.setState({
        nodes: { q1: node('q1', false), q2: node('q2', false), other: node('other') },
      });
    });
    expect(result.current).toBe(before);
  });
});
