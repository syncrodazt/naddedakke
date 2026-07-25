import type { Highlight } from '../model/types';

// A highlight's [start, end) offsets are only meaningful for the exact markdown
// they were captured from. Regenerating a node replaces that markdown wholesale,
// so the stored offsets then point at whatever happens to sit at those character
// positions in the new text — underlining the wrong words, or nothing at all.
//
// `Highlight.text` is the denormalized quote kept precisely for this case (the
// data model calls it the offset drift guard). Re-anchoring searches the new
// markdown for that quote and rewrites the offsets to match.
//
// A quote that no longer appears collapses to a zero-width anchor rather than
// being deleted: every branch must stay anchored to its parent (a branch with no
// anchor is a bug), and zero-width is the same convention free-form idea
// branches already use — the link survives, no underline is drawn.

export function reanchorHighlights(md: string, highlights: Highlight[]): Highlight[] {
  // Consume matches left to right so repeated quotes keep their relative order
  // instead of all snapping onto the first occurrence.
  let cursor = 0;

  return highlights.map((h) => {
    if (h.text === '') return h.start === 0 && h.end === 0 ? h : { ...h, start: 0, end: 0 };

    // Still correct? Leave it exactly as it is.
    if (md.slice(h.start, h.end) === h.text && h.start >= cursor) {
      cursor = h.end;
      return h;
    }

    const found = md.indexOf(h.text, cursor);
    const at = found === -1 ? md.indexOf(h.text) : found;
    if (at === -1) return { ...h, start: 0, end: 0 };

    cursor = at + h.text.length;
    return { ...h, start: at, end: cursor };
  });
}

/** True when a highlight has no visible range (orphaned, or a whole-node idea anchor). */
export function isZeroWidth(h: Highlight): boolean {
  return h.start >= h.end;
}
