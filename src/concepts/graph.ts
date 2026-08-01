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
  return new Set([id, ...ancestors(map, id), ...dependents(map, id)]);
}
