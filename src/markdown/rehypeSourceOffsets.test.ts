import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import { visit } from 'unist-util-visit';
import type { Element, Root } from 'hast';
import { rehypeSourceOffsets } from './rehypeSourceOffsets';

function renderTree(md: string): Root {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(() => rehypeSourceOffsets(md));
  return processor.runSync(processor.parse(md)) as Root;
}

function collectSegs(tree: Root): { start: number; end: number; text: string }[] {
  const segs: { start: number; end: number; text: string }[] = [];
  visit(tree, 'element', (el: Element) => {
    const start = el.properties.dataMdStart;
    const end = el.properties.dataMdEnd;
    if (typeof start !== 'number' || typeof end !== 'number') return;
    const child = el.children[0];
    segs.push({ start, end, text: child?.type === 'text' ? child.value : '' });
  });
  return segs;
}

const FIXTURES = [
  'Just a plain paragraph of text.',
  'A sentence with **bold in the middle** and a tail.',
  '- first item\n- second item with `code`\n- third',
  '## Heading\n\nFirst paragraph.\n\nSecond paragraph with *emphasis* inside.',
];

describe('rehypeSourceOffsets', () => {
  it.each(FIXTURES)('every annotated span slices back to the source: %s', (md) => {
    const segs = collectSegs(renderTree(md));
    expect(segs.length).toBeGreaterThan(0);
    for (const seg of segs) {
      expect(md.slice(seg.start, seg.end)).toBe(seg.text);
    }
  });

  it('covers all visible text of a bold-split paragraph', () => {
    const md = 'alpha **beta** gamma';
    const segs = collectSegs(renderTree(md));
    expect(segs.map((s) => s.text)).toEqual(['alpha ', 'beta', ' gamma']);
  });
});
