import { useMemo } from 'react';
import type { Highlight } from '../../model/types';
import { useGraphStore } from '../../store/graphStore';
import { isRevealed, useVisibilityStore } from '../../replay/visibilityStore';

/**
 * Ids of a node's highlights whose spawned question the learner has marked
 * understood — rendered teal (resolved) instead of pink.
 *
 * Answering that needs to look at *other* nodes, and the obvious way to do it —
 * `useGraphStore((s) => s.nodes)` — subscribes to the whole map. Every store
 * write hands back a new map object, so dragging one node re-rendered all of
 * them, and the fresh array identity broke MarkdownContent's memo, re-parsing
 * every body (markdown + KaTeX) on every pointer move. That was 780ms frames on
 * a 240-node graph.
 *
 * Selecting a joined string instead makes the subscription compare by value:
 * the component re-renders only when the resolved set actually changes.
 */
export function useResolvedHighlights(highlights: Highlight[]): string[] {
  // Only nodes the learner has actually been shown count. During replay the
  // question that resolved a highlight may not have appeared yet, and drawing
  // it teal ahead of time would give away the ending of the very thing replay
  // is there to show.
  const visibleIds = useVisibilityStore((s) => s.visibleIds);
  const key = useGraphStore((s) =>
    highlights
      .filter((h) => {
        if (h.childNodeId === undefined) return false;
        const child = s.nodes[h.childNodeId];
        return child?.understood === true && isRevealed(visibleIds, child.id);
      })
      .map((h) => h.id)
      .join(','),
  );
  return useMemo(() => (key === '' ? [] : key.split(',')), [key]);
}
