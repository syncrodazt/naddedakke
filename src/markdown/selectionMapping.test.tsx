import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownContent } from './MarkdownContent';
import { mapRangeToSource } from './selectionMapping';

function renderMd(md: string) {
  const { container } = render(<MarkdownContent nodeId="n1" md={md} />);
  const root = container.querySelector<HTMLElement>('[data-node-id="n1"]')!;
  return { root, md };
}

/** Find the rendered text node containing `needle` and return (node, offsetOfNeedle). */
function textNodeWith(root: HTMLElement, needle: string): { node: Node; offset: number } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const idx = t.textContent!.indexOf(needle);
    if (idx !== -1) return { node: t, offset: idx };
  }
  throw new Error(`no text node contains "${needle}"`);
}

describe('mapRangeToSource', () => {
  it('maps a selection within one segment to source offsets', () => {
    const { root, md } = renderMd('The sky is blue because of scattering.');
    const { node, offset } = textNodeWith(root, 'scattering');
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset + 'scattering'.length);
    const mapped = mapRangeToSource(root, md, range)!;
    expect(mapped).not.toBeNull();
    expect(md.slice(mapped.start, mapped.end)).toBe('scattering');
  });

  it('maps a selection crossing a bold boundary', () => {
    const md = 'A rule derived from **exponential growth** in practice.';
    const { root } = renderMd(md);
    const from = textNodeWith(root, 'derived');
    const to = textNodeWith(root, 'exponential');
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset + 'exponential'.length);
    const mapped = mapRangeToSource(root, md, range)!;
    expect(mapped).not.toBeNull();
    expect(mapped.text).toBe('derived from **exponential');
    expect(md.slice(mapped.start, mapped.end)).toBe(mapped.text);
  });

  it('maps an element-container endpoint (triple-click style selection)', () => {
    const md = 'Only one paragraph here.';
    const { root } = renderMd(md);
    const p = root.querySelector('p')!;
    const range = document.createRange();
    range.setStart(p, 0);
    range.setEnd(p, p.childNodes.length);
    const mapped = mapRangeToSource(root, md, range)!;
    expect(mapped).not.toBeNull();
    expect(mapped.text).toBe(md);
  });

  it('rejects a collapsed range', () => {
    const { root, md } = renderMd('Some text.');
    const { node } = textNodeWith(root, 'Some');
    const range = document.createRange();
    range.setStart(node, 1);
    range.setEnd(node, 1);
    expect(mapRangeToSource(root, md, range)).toBeNull();
  });

  it('rejects a range outside the container', () => {
    const { root, md } = renderMd('Inside text.');
    const outside = document.createElement('div');
    outside.textContent = 'outside text';
    document.body.appendChild(outside);
    const range = document.createRange();
    range.selectNodeContents(outside.firstChild!);
    expect(mapRangeToSource(root, md, range)).toBeNull();
    outside.remove();
  });

  it('falls back to normalized text search for unannotated regions', () => {
    const md = 'plain before formula';
    const { root } = renderMd(md);
    // Simulate an unannotated region by stripping the data attributes.
    root.querySelectorAll('[data-md-start]').forEach((el) => {
      el.removeAttribute('data-md-start');
      el.removeAttribute('data-md-end');
    });
    const { node, offset } = textNodeWith(root, 'before');
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset + 'before'.length);
    const mapped = mapRangeToSource(root, md, range)!;
    expect(mapped).not.toBeNull();
    expect(md.slice(mapped.start, mapped.end)).toBe('before');
  });

  it('returns null when the selection cannot be found at all', () => {
    const md = 'alpha beta';
    const { root } = renderMd(md);
    root.querySelectorAll('[data-md-start]').forEach((el) => {
      el.removeAttribute('data-md-start');
      el.removeAttribute('data-md-end');
    });
    const { node } = textNodeWith(root, 'alpha');
    node.textContent = 'completely different words';
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 10);
    expect(mapRangeToSource(root, md, range)).toBeNull();
  });
});
