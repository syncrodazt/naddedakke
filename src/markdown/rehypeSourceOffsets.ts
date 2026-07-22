import type { Element, Root, Text } from 'hast';
import { visit } from 'unist-util-visit';

// remark records each text node's character offsets into the raw markdown
// source, and remark-rehype preserves them. Wrapping every positioned text
// node in <span data-md-start data-md-end> lets a DOM selection be mapped
// straight back to source offsets — no reverse search needed.
//
// Positions cover the markdown *syntax* of a node, so for inline code the
// range includes the backticks while the rendered text does not. Each span is
// therefore verified against the actual source slice and tightened to the
// rendered text where possible; spans whose text can't be located in their
// slice are left unannotated (selection mapping falls back to a text search).
// Text without position info at all (e.g. KaTeX output) also stays unwrapped.
export function rehypeSourceOffsets(md: string) {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (index === undefined || parent === undefined) return undefined;
      if (parent.type === 'element' && parent.tagName === 'span') {
        const cls = parent.properties.className;
        if (Array.isArray(cls) && cls.includes('md-seg')) return undefined;
      }
      let start = node.position?.start.offset;
      let end = node.position?.end.offset;
      if (start === undefined || end === undefined) return undefined;

      const slice = md.slice(start, end);
      if (slice !== node.value) {
        const inner = slice.indexOf(node.value);
        if (inner === -1 || slice.indexOf(node.value, inner + 1) !== -1) return undefined;
        start += inner;
        end = start + node.value.length;
      }

      const span: Element = {
        type: 'element',
        tagName: 'span',
        properties: { dataMdStart: start, dataMdEnd: end, className: ['md-seg'] },
        children: [{ type: 'text', value: node.value }],
      };
      parent.children[index] = span;
      // Skip over the span we just inserted so its inner text isn't rewrapped.
      return index + 1;
    });
  };
}
