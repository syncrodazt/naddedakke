import type { Concept, ConceptMap } from './types';

// Parsing a proposed concept map.
//
// This is untrusted model output that becomes a curriculum, so everything
// unusable is dropped here rather than reaching the ranking, where a bad
// prerequisite would quietly change what the learner is told to do next.

export class ConceptMapError extends Error {}

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

export function parseConceptMap(raw: string, options: ParseOptions): ConceptMap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    throw new ConceptMapError('reply was not JSON');
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.concepts)) {
    throw new ConceptMapError('reply has no "concepts" array');
  }

  const concepts: Concept[] = [];
  const seen = new Set<string>();
  for (const entry of parsed.concepts) {
    if (!isRecord(entry)) continue;
    const { id, name, blurb, prereqs, sessionIds, why } = entry;
    if (typeof id !== 'string' || !ID.test(id) || seen.has(id)) continue;
    if (typeof name !== 'string' || name.trim() === '') continue;
    seen.add(id);
    concepts.push({
      id,
      name: name.trim(),
      blurb: typeof blurb === 'string' ? blurb.trim() : '',
      prereqs: strings(prereqs).filter((p) => ID.test(p) && p !== id),
      // A notebook id the model invented would make an unknown concept look
      // known, which is the one error that hides work instead of adding it.
      sessionIds: strings(sessionIds).filter((s) => options.knownSessionIds.has(s)),
      ...(typeof why === 'string' && why.trim() !== '' ? { why: why.trim() } : {}),
    });
  }

  if (concepts.length === 0) throw new ConceptMapError('reply had no usable concepts');

  // Prerequisites pointing at concepts that were dropped are dropped too, so
  // the map that reaches the ranking is internally consistent.
  const ids = new Set(concepts.map((c) => c.id));
  for (const concept of concepts) {
    concept.prereqs = concept.prereqs.filter((p) => ids.has(p));
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
