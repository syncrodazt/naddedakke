import type { Element, ElementContent, Root } from 'hast';
import { visit } from 'unist-util-visit';
import type { Highlight } from '../model/types';

// Runs after rehypeSourceOffsets. Where a persisted highlight's [start, end)
// source range intersects an annotated md-seg span, the span's text is split
// at the overlap boundaries and the overlapping piece is wrapped in
// <mark data-highlight-id>. The markdown source itself is never mutated —
// that would shift every stored offset.
export function rehypeHighlightMarks(highlights: Highlight[]) {
  return (tree: Root) => {
    if (highlights.length === 0) return;
    visit(tree, 'element', (el: Element) => {
      if (el.tagName !== 'span') return;
      const segStart = el.properties.dataMdStart;
      const segEnd = el.properties.dataMdEnd;
      if (typeof segStart !== 'number' || typeof segEnd !== 'number') return;
      const only = el.children[0];
      if (el.children.length !== 1 || only === undefined || only.type !== 'text') return;
      const text = only.value;

      const cuts = highlights
        .map((h) => ({
          id: h.id,
          start: Math.max(h.start, segStart),
          end: Math.min(h.end, segEnd),
        }))
        .filter((c) => c.start < c.end)
        .sort((a, b) => a.start - b.start);
      if (cuts.length === 0) return;

      const children: ElementContent[] = [];
      let cursor = segStart;
      for (const cut of cuts) {
        const start = Math.max(cut.start, cursor);
        if (start >= cut.end) continue; // clipped away by an earlier overlapping highlight
        if (start > cursor) {
          children.push({ type: 'text', value: text.slice(cursor - segStart, start - segStart) });
        }
        children.push({
          type: 'element',
          tagName: 'mark',
          properties: { dataHighlightId: cut.id },
          children: [{ type: 'text', value: text.slice(start - segStart, cut.end - segStart) }],
        });
        cursor = cut.end;
      }
      if (cursor < segEnd) {
        children.push({ type: 'text', value: text.slice(cursor - segStart) });
      }
      el.children = children;
    });
  };
}
