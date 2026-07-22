import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import { visit } from 'unist-util-visit';
import type { Element, Root, Text } from 'hast';
import type { Highlight } from '../model/types';
import { rehypeSourceOffsets } from './rehypeSourceOffsets';
import { rehypeHighlightMarks } from './rehypeHighlightMarks';

function renderTree(md: string, highlights: Highlight[]): Root {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(() => rehypeSourceOffsets(md))
    .use(() => rehypeHighlightMarks(highlights));
  return processor.runSync(processor.parse(md)) as Root;
}

function fullText(tree: Root): string {
  let out = '';
  visit(tree, 'text', (t: Text) => {
    out += t.value;
  });
  return out;
}

function markTexts(tree: Root): Record<string, string> {
  const marks: Record<string, string> = {};
  visit(tree, 'element', (el: Element) => {
    if (el.tagName !== 'mark') return;
    const id = String(el.properties.dataHighlightId);
    let text = '';
    visit(el, 'text', (t: Text) => {
      text += t.value;
    });
    marks[id] = (marks[id] ?? '') + text;
  });
  return marks;
}

function hl(id: string, start: number, end: number, text: string): Highlight {
  return { id, start, end, text };
}

describe('rehypeHighlightMarks', () => {
  it('wraps a highlight inside a single text segment', () => {
    const md = 'alpha beta gamma';
    const tree = renderTree(md, [hl('h1', 6, 10, 'beta')]);
    expect(markTexts(tree)).toEqual({ h1: 'beta' });
    expect(fullText(tree)).toBe(md);
  });

  it('splits a highlight spanning a bold boundary across segments', () => {
    const md = 'alpha **beta** gamma';
    const start = md.indexOf('alpha') + 2;
    const end = md.indexOf('beta') + 4; // "pha " + "beta" across the ** boundary
    const tree = renderTree(md, [hl('h1', start, end, 'pha beta')]);
    const marks = markTexts(tree);
    expect(marks.h1).toBe('pha beta');
    expect(fullText(tree)).toBe('alpha beta gamma');
  });

  it('keeps text intact with adjacent and overlapping highlights', () => {
    const md = 'one two three four';
    const tree = renderTree(md, [
      hl('h1', 0, 7, 'one two'),
      hl('h2', 7, 13, ' three'), // adjacent
      hl('h3', 4, 9, 'two t'), // overlaps both
    ]);
    expect(fullText(tree)).toBe(md);
  });

  it('adds the resolved class only to resolved highlight marks', () => {
    const md = 'one two three';
    const processor = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype)
      .use(() => rehypeSourceOffsets(md))
      .use(() =>
        rehypeHighlightMarks([hl('h1', 0, 3, 'one'), hl('h2', 8, 13, 'three')], new Set(['h2'])),
      );
    const tree = processor.runSync(processor.parse(md)) as Root;
    const classes: Record<string, unknown> = {};
    visit(tree, 'element', (el: Element) => {
      if (el.tagName === 'mark')
        classes[String(el.properties.dataHighlightId)] = el.properties.className;
    });
    expect(classes.h2).toEqual(['resolved']);
    expect(classes.h1).toBeUndefined();
  });

  it('ignores highlights outside the rendered text', () => {
    const md = 'short';
    const tree = renderTree(md, [hl('h1', 100, 120, 'nope')]);
    expect(markTexts(tree)).toEqual({});
    expect(fullText(tree)).toBe(md);
  });
});
