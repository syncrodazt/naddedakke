import { reanchorHighlights } from '../markdown/reanchor';
import type { Highlight, RNode } from './types';

// Which body of a node to actually show, and where its highlights sit in it.
//
// A node holds the original markdown plus zero or more translations. Nothing is
// ever overwritten, so "read this notebook in Thai" is a *view* over the same
// graph rather than an edit to it — the original is always one click away and a
// translation that goes missing degrades to showing the original, never to a
// blank node.
//
// Highlights are the hard part. Their offsets only mean anything in the exact
// text they were captured from, so a translated body needs the passage found
// again. That is the same problem `Highlight.text` already solves for a
// regenerated node, so it is solved the same way: the quote is translated too,
// and re-anchoring searches for it. A quote that cannot be found collapses to a
// zero-width anchor — the branch keeps its link to the parent (a branch with no
// anchor is a bug), it just has nothing to underline.

export type DisplayContent = {
  md: string;
  highlights: Highlight[];
  /** Language identity of `md`: a translations key, or the original's `lang`. */
  bodyLang: string | undefined;
  /** True when this is a translation rather than the body as written. */
  translated: boolean;
};

/**
 * The passage this highlight marks, quoted in `bodyLang`, or '' when that
 * language has no quote for it yet.
 */
export function quoteFor(
  h: Highlight,
  bodyLang: string | undefined,
  canonicalLang: string | undefined,
): string {
  // The language whose body this highlight's own offsets index.
  const home = h.lang ?? canonicalLang;
  if (home === bodyLang) return h.text;
  if (bodyLang === undefined) return '';
  return h.quotes?.[bodyLang] ?? '';
}

export function resolveContent(content: RNode['content'], want?: string): DisplayContent {
  // Which body to show. Anything we don't have falls back to the original —
  // showing what was actually written always beats showing nothing.
  const translation = want === undefined ? undefined : content.translations?.[want];
  const translated = translation !== undefined && want !== content.lang;
  const bodyLang = translated ? want : content.lang;
  const md = translated ? translation : content.md;

  // Highlights already anchored in this body are left exactly as they are —
  // including their array identity, which is what keeps the markdown memo
  // alive on the common path where nothing has ever been translated.
  const needsAnchoring = content.highlights.some((h) => (h.lang ?? content.lang) !== bodyLang);
  const highlights = needsAnchoring
    ? reanchorHighlights(
        md,
        content.highlights.map((h) => ({ ...h, text: quoteFor(h, bodyLang, content.lang) })),
      )
    : content.highlights;

  return { md, highlights, bodyLang, translated };
}

// Content objects are replaced wholesale on every store write, so the object
// itself is a sound cache key — and a WeakMap drops entries for nodes that go
// away. This matters for identity, not just speed: MarkdownContent memoizes on
// (md, highlights), and rebuilding the highlight array every render would
// re-parse every body (markdown + KaTeX) on every pointer move.
const cache = new WeakMap<RNode['content'], Map<string, DisplayContent>>();

export function displayContent(content: RNode['content'], want?: string): DisplayContent {
  const key = want ?? '';
  let perLang = cache.get(content);
  if (perLang === undefined) {
    perLang = new Map();
    cache.set(content, perLang);
  }
  const hit = perLang.get(key);
  if (hit !== undefined) return hit;
  const resolved = resolveContent(content, want);
  perLang.set(key, resolved);
  return resolved;
}

/** The body of a node as the learner currently reads it. */
export function displayMd(node: RNode, want?: string): string {
  return displayContent(node.content, want).md;
}
