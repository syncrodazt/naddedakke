export type MappedSelection = { start: number; end: number; text: string };

// Maps a DOM Range inside rendered markdown back to character offsets in the
// markdown source. Primary path: each rendered text segment carries
// data-md-start/data-md-end (see rehypeSourceOffsets), so an endpoint's source
// offset is segStart + offset-within-segment. Fallback path: whitespace-
// normalized substring search of the selected text in the source.
export function mapRangeToSource(
  container: HTMLElement,
  md: string,
  range: Range,
): MappedSelection | null {
  if (range.collapsed) return null;
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return null;
  }

  const start = resolveEndpoint(range.startContainer, range.startOffset, 'start');
  const end = resolveEndpoint(range.endContainer, range.endOffset, 'end');
  if (start !== null && end !== null && start < end && end <= md.length) {
    return { start, end, text: md.slice(start, end) };
  }

  return fallbackSearch(md, range.toString());
}

/** Source offset for one Range endpoint, or null if it lands outside any annotated segment. */
function resolveEndpoint(node: Node, offset: number, side: 'start' | 'end'): number | null {
  let textNode: Node | null = node;
  let textOffset = offset;

  if (node.nodeType !== Node.TEXT_NODE) {
    // Element endpoint (e.g. triple-click selection): descend to the boundary text node.
    const children = node.childNodes;
    const anchor = side === 'start' ? children[offset] : children[offset - 1];
    textNode = anchor ? boundaryTextNode(anchor, side === 'start' ? 'first' : 'last') : null;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return null;
    textOffset = side === 'start' ? 0 : (textNode.textContent?.length ?? 0);
  }

  const seg = (textNode.parentElement ?? null)?.closest<HTMLElement>('[data-md-start]') ?? null;
  if (!seg) return null;
  const segStart = Number(seg.dataset.mdStart);
  const segEnd = Number(seg.dataset.mdEnd);
  if (!Number.isFinite(segStart) || !Number.isFinite(segEnd)) return null;

  // The segment may contain several text nodes after highlight marks split it;
  // accumulate the lengths of the text nodes preceding the endpoint's node.
  let acc = 0;
  const walker = document.createTreeWalker(seg, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (t === textNode) return Math.min(segStart + acc + textOffset, segEnd);
    acc += t.textContent?.length ?? 0;
  }
  return null;
}

function boundaryTextNode(node: Node, which: 'first' | 'last'): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return node;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  if (which === 'first') return walker.nextNode();
  let last: Node | null = null;
  for (let t = walker.nextNode(); t; t = walker.nextNode()) last = t;
  return last;
}

/** Whitespace-normalize a string, keeping a map from normalized index → original index. */
function normalizeWithMap(s: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (/\s/.test(ch)) {
      pendingSpace = norm.length > 0;
      continue;
    }
    if (pendingSpace) {
      norm += ' ';
      map.push(-1); // synthetic space — never used as a boundary directly
      pendingSpace = false;
    }
    norm += ch;
    map.push(i);
  }
  return { norm, map };
}

function fallbackSearch(md: string, selected: string): MappedSelection | null {
  const sel = normalizeWithMap(selected);
  if (sel.norm.length === 0) return null;
  const src = normalizeWithMap(md);
  const idx = src.norm.indexOf(sel.norm);
  if (idx === -1) return null;
  // Anchor on the first and last non-synthetic characters of the match.
  let startNorm = idx;
  while (src.map[startNorm] === -1) startNorm++;
  let endNorm = idx + sel.norm.length - 1;
  while (endNorm > startNorm && src.map[endNorm] === -1) endNorm--;
  const start = src.map[startNorm]!;
  const end = src.map[endNorm]! + 1;
  if (start >= end) return null;
  return { start, end, text: md.slice(start, end) };
}
