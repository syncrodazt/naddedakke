import type { Concept, ConceptMap, ConceptStatus, RankedConcept } from './types';
import { dependents } from './graph';

// Turning a concept map into "learn this next".
//
// Everything here is pure and works on plain data, because this is the part
// that has to be right: it is the actual recommendation, and a plausible-
// looking wrong one costs the learner hours.

/** Understood-node ratio at which a notebook counts as knowing its concept. */
export const KNOWN_THRESHOLD = 0.6;

export type Coverage = Record<string, { understood: number; total: number }>;

/**
 * How much of each concept the learner has, from their notebooks.
 *
 * "Known" needs a threshold rather than all-or-nothing: a notebook where every
 * chunk but one is understood is knowledge, and demanding perfection would mean
 * almost nothing ever counts and the recommendations never move.
 */
export function statusOf(concept: Concept, coverage: Coverage): ConceptStatus {
  const covering = concept.sessionIds.map((id) => coverage[id]).filter((c) => c !== undefined);
  if (covering.length === 0) return 'unknown';
  const understood = covering.reduce((sum, c) => sum + c.understood, 0);
  const total = covering.reduce((sum, c) => sum + c.total, 0);
  if (total === 0) return 'met';
  return understood / total >= KNOWN_THRESHOLD ? 'known' : 'met';
}

export function statusMap(map: ConceptMap, coverage: Coverage): Record<string, ConceptStatus> {
  return Object.fromEntries(map.concepts.map((c) => [c.id, statusOf(c, coverage)]));
}

/**
 * Rank every concept the learner does not already know.
 *
 * The obvious ranking is "most connected first" — the hub. It is wrong twice
 * over: a hub whose own prerequisites you lack is not something you can start,
 * and a hub surrounded entirely by things you already know unlocks nothing,
 * however many edges it has. So the ranking is what it actually opens up, among
 * things you do not yet have, gated on being able to begin.
 */
export function rankConcepts(map: ConceptMap, coverage: Coverage): RankedConcept[] {
  const status = statusMap(map, coverage);
  const byId = new Map(map.concepts.map((c) => [c.id, c]));

  const ranked = map.concepts
    .filter((c) => status[c.id] !== 'known')
    .map((concept) => {
      // Prerequisites naming concepts that are not in the map are dropped
      // rather than treated as unmet, or one bad id would make a concept
      // permanently unreachable.
      const real = concept.prereqs.filter((p) => byId.has(p));
      const missing = real
        .filter((p) => status[p] !== 'known')
        .map((p) => byId.get(p)!.name)
        .sort();
      const unlocks = [...dependents(map, concept.id)].filter((d) => status[d] !== 'known').length;
      return {
        concept,
        status: status[concept.id]!,
        ready: missing.length === 0,
        missing,
        unlocks,
        grounding: real.filter((p) => status[p] === 'known').length,
      };
    });

  return ranked.sort(compare);
}

function compare(a: RankedConcept, b: RankedConcept): number {
  // Ready first: something you cannot start is not a next step, however
  // valuable it would be once you could.
  if (a.ready !== b.ready) return a.ready ? -1 : 1;
  if (a.unlocks !== b.unlocks) return b.unlocks - a.unlocks;
  // Then whichever rests on more of what you already have — a concept with
  // three familiar prerequisites is a shorter reach than one with none.
  if (a.grounding !== b.grounding) return b.grounding - a.grounding;
  // Something you already started beats a blank page.
  if (a.status !== b.status) return a.status === 'met' ? -1 : 1;
  // Deterministic, so the list does not reshuffle between renders.
  return a.concept.name.localeCompare(b.concept.name);
}
