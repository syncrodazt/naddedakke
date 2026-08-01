import type { ConceptMap } from './types';

// Walking the prerequisite graph.
//
// Every traversal here is cycle-safe. The parser cuts loops before anything is
// stored, but a map can also arrive from an older build or a hand-edited
// database, and a hang is a much worse failure than a slightly odd answer.

/** id → the concepts that list it as a prerequisite. */
export function childIndex(map: ConceptMap): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const concept of map.concepts) {
    for (const prereq of concept.prereqs) {
      children.set(prereq, [...(children.get(prereq) ?? []), concept.id]);
    }
  }
  return children;
}

function reach(start: string, next: (id: string) => string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...next(start)];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (seen.has(id) || id === start) continue;
    seen.add(id);
    queue.push(...next(id));
  }
  return seen;
}

/** Concepts that transitively require this one — everything it opens up. */
export function dependents(map: ConceptMap, id: string): Set<string> {
  const children = childIndex(map);
  return reach(id, (x) => children.get(x) ?? []);
}

/** Concepts this one transitively requires — everything it rests on. */
export function ancestors(map: ConceptMap, id: string): Set<string> {
  const byId = new Map(map.concepts.map((c) => [c.id, c]));
  return reach(id, (x) => byId.get(x)?.prereqs ?? []);
}

/** Immediate prerequisites, in map order. */
export function directPrereqs(map: ConceptMap, id: string): string[] {
  const concept = map.concepts.find((c) => c.id === id);
  if (!concept) return [];
  const ids = new Set(map.concepts.map((c) => c.id));
  return concept.prereqs.filter((p) => ids.has(p));
}

/** Concepts that name this one as a prerequisite — the very next steps. */
export function directDependents(map: ConceptMap, id: string): string[] {
  return map.concepts.filter((c) => c.prereqs.includes(id)).map((c) => c.id);
}

/**
 * The concept plus everything up- and downstream of it: what a selection should
 * light up. Anything outside this set is unrelated to the question "what does
 * this one sit between", and fades.
 */
export function lineage(map: ConceptMap, id: string): Set<string> {
  // Analogues are included: "this same idea also lives over there" is precisely
  // what selecting a concept should reveal, and hiding the twin would leave the
  // link drawn to a card that had just been faded out.
  const twins = analoguesOf(map, id).map((l) => l.id);
  return new Set([id, ...ancestors(map, id), ...dependents(map, id), ...twins]);
}

/**
 * Cross-domain links touching a concept, in both directions.
 *
 * The relation is symmetric but stored once, so an analogue may name this
 * concept rather than the other way round — looking only at `concept.sameAs`
 * would show the link on one card and not on its twin.
 */
export function analoguesOf(map: ConceptMap, id: string): { id: string; how: string }[] {
  const out: { id: string; how: string }[] = [];
  for (const link of map.concepts.find((c) => c.id === id)?.sameAs ?? []) {
    out.push(link);
  }
  for (const concept of map.concepts) {
    for (const link of concept.sameAs ?? []) {
      if (link.id === id) out.push({ id: concept.id, how: link.how });
    }
  }
  return out;
}

/** Every cross-domain link in the map, once each. */
export function sameAsPairs(map: ConceptMap): { a: string; b: string; how: string }[] {
  return map.concepts.flatMap((c) =>
    (c.sameAs ?? []).map((l) => ({ a: c.id, b: l.id, how: l.how })),
  );
}
