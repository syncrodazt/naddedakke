import type { Concept, ConceptMap } from './types';

// Parsing a proposed concept map.
//
// This is untrusted model output that becomes a curriculum, so everything
// unusable is dropped here rather than reaching the ranking, where a bad
// prerequisite would quietly change what the learner is told to do next.

export class ConceptMapError extends Error {}

/** Band for concepts the model did not file anywhere. */
export const UNSORTED = '—';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function stripFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/```\s*$/, '')
    .trim();
}

/** Slugs only: ids end up as React keys and as links from notebooks. */
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type ParseOptions = {
  /** Real notebook ids. Anything else the model claims is discarded. */
  knownSessionIds: Set<string>;
  generatedAt: number;
  builtFrom: string[];
};

/**
 * Complete `{...}` objects inside the reply's `concepts` array.
 *
 * A concept map is a long document, and a reply that runs out of budget stops
 * mid-object — which makes the whole thing unparseable even though thirteen of
 * the fourteen concepts arrived intact. Rather than throw all of that away,
 * whatever finished is recovered.
 *
 * Braces inside strings do not count, or a blurb containing one would end its
 * object early and produce nonsense.
 */
export function salvageConcepts(raw: string): unknown[] {
  const marker = raw.indexOf('"concepts"');
  const open = marker === -1 ? -1 : raw.indexOf('[', marker);
  if (open === -1) return [];

  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = open + 1; i < raw.length; i++) {
    const ch = raw[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try {
          out.push(JSON.parse(raw.slice(start, i + 1)));
        } catch {
          // A complete-looking object that still will not parse is skipped.
        }
        start = -1;
      }
    } else if (ch === ']' && depth === 0) break;
  }
  return out;
}

export function parseConceptMap(raw: string, options: ParseOptions): ConceptMap {
  let entries: unknown[];
  try {
    const parsed: unknown = JSON.parse(stripFence(raw));
    if (!isRecord(parsed) || !Array.isArray(parsed.concepts)) {
      throw new ConceptMapError('reply has no "concepts" array');
    }
    entries = parsed.concepts;
  } catch (err) {
    if (err instanceof ConceptMapError) throw err;
    entries = salvageConcepts(raw);
    if (entries.length === 0) {
      // Say what actually came back. "Not JSON" alone reads the same for an
      // empty reply, an error page and a chatty model, and those need
      // different things done about them.
      const text = raw.trim();
      throw new ConceptMapError(
        text === ''
          ? 'the model returned nothing — try again, or pick another model in Settings'
          : `reply was not JSON (${text.length} chars, starts: ${text.slice(0, 80)})`,
      );
    }
  }

  const concepts: Concept[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const { id, name, area, blurb, prereqs, sessionIds, why, sameAs } = entry;
    if (typeof id !== 'string' || !ID.test(id) || seen.has(id)) continue;
    if (typeof name !== 'string' || name.trim() === '') continue;
    seen.add(id);
    concepts.push({
      id,
      name: name.trim(),
      // Everything must land in some band, so an unlabelled concept gets one
      // rather than vanishing from the layout.
      area: typeof area === 'string' && area.trim() !== '' ? area.trim() : UNSORTED,
      blurb: typeof blurb === 'string' ? blurb.trim() : '',
      prereqs: strings(prereqs).filter((p) => ID.test(p) && p !== id),
      // A notebook id the model invented would make an unknown concept look
      // known, which is the one error that hides work instead of adding it.
      sessionIds: strings(sessionIds).filter((s) => options.knownSessionIds.has(s)),
      ...(typeof why === 'string' && why.trim() !== '' ? { why: why.trim() } : {}),
      ...(analogies(sameAs).length > 0 ? { sameAs: analogies(sameAs) } : {}),
    });
  }

  if (concepts.length === 0) throw new ConceptMapError('reply had no usable concepts');

  // Prerequisites pointing at concepts that were dropped are dropped too, so
  // the map that reaches the ranking is internally consistent.
  const ids = new Set(concepts.map((c) => c.id));
  const areaOf = new Map(concepts.map((c) => [c.id, c.area]));
  const seenPair = new Set<string>();
  for (const concept of concepts) {
    concept.prereqs = concept.prereqs.filter((p) => ids.has(p));
    if (!concept.sameAs) continue;
    const kept = concept.sameAs.filter((link) => {
      if (!ids.has(link.id) || link.id === concept.id) return false;
      // Same subject means the band already puts them side by side and the
      // prerequisite edges already relate them — the claim only earns a line of
      // its own when it crosses fields. The cost is losing a true within-subject
      // equivalence; the gain is that the links that show up are all news.
      if (areaOf.get(link.id) === concept.area) return false;
      // The relation is symmetric, so keep one of A→B and B→A.
      const pair = [concept.id, link.id].sort().join('|');
      if (seenPair.has(pair)) return false;
      seenPair.add(pair);
      return true;
    });
    if (kept.length > 0) concept.sameAs = kept;
    else delete concept.sameAs;
  }

  return {
    id: 'current',
    generatedAt: options.generatedAt,
    builtFrom: options.builtFrom,
    concepts: breakCycles(concepts),
  };
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** `sameAs` entries that are shaped right. Links are resolved later. */
function analogies(v: unknown): { id: string; how: string }[] {
  if (!Array.isArray(v)) return [];
  const out: { id: string; how: string }[] = [];
  for (const entry of v) {
    if (!isRecord(entry)) continue;
    const { id, how } = entry;
    if (typeof id !== 'string' || !ID.test(id)) continue;
    // No justification, no link. "These are the same" with no account of how is
    // the one claim here that is both the most valuable and the easiest to
    // fabricate, so an unexplained one is discarded rather than shown.
    if (typeof how !== 'string' || how.trim() === '') continue;
    out.push({ id, how: how.trim() });
  }
  return out;
}

/**
 * Remove prerequisite edges that close a loop.
 *
 * A cycle means "learn A before B, and B before A", which is not a curriculum
 * at all. The traversal in ranking survives cycles, but leaving them in would
 * leave both concepts permanently unstartable and never say why — so they are
 * cut here, keeping whichever edge comes first in a stable ordering.
 */
export function breakCycles(concepts: Concept[]): Concept[] {
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const state = new Map<string, 'visiting' | 'done'>();
  const kept = new Map<string, string[]>();

  function visit(id: string): void {
    if (state.get(id) === 'done') return;
    state.set(id, 'visiting');
    const keep: string[] = [];
    for (const prereq of byId.get(id)?.prereqs ?? []) {
      // Back-edge into something still on the stack: that closes a loop.
      if (state.get(prereq) === 'visiting') continue;
      visit(prereq);
      keep.push(prereq);
    }
    kept.set(id, keep);
    state.set(id, 'done');
  }

  // Deterministic order in, deterministic map out.
  for (const concept of [...concepts].sort((a, b) => a.id.localeCompare(b.id))) visit(concept.id);
  return concepts.map((c) => ({ ...c, prereqs: kept.get(c.id) ?? [] }));
}
