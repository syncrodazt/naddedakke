import type { ConceptMap } from './types';

// Laying out the skill tree.
//
// Never force-directed. A physics simulation would produce the same hairball
// this project's spec rules out, and it would hide the one thing the graph is
// for: what comes before what. Depth from the roots is the x axis, so the
// picture reads left to right as foundations → what they open up, the same
// direction the lesson spine already runs.

export type Tier = 'small' | 'medium' | 'large';

/** Card width by leverage. Bigger really does mean "opens up more". */
export const TIER_WIDTH: Record<Tier, number> = { small: 190, medium: 230, large: 280 };
export const CARD_H = 92;
export const COL_GAP = 96;
export const ROW_GAP = 24;
/** Columns are spaced on the widest card, so no two ever collide. */
export const COL_W = TIER_WIDTH.large + COL_GAP;

export function sizeTier(unlocks: number): Tier {
  if (unlocks >= 5) return 'large';
  if (unlocks >= 2) return 'medium';
  return 'small';
}

/**
 * How many prerequisites deep each concept sits: 0 for something with no
 * prerequisites, otherwise one past the deepest thing it needs.
 *
 * A concept caught in a cycle is treated as if the looping edge were not there,
 * rather than recursing forever.
 */
export function depths(map: ConceptMap): Record<string, number> {
  const byId = new Map(map.concepts.map((c) => [c.id, c]));
  const depth: Record<string, number> = {};
  const visiting = new Set<string>();

  function resolve(id: string): number {
    const cached = depth[id];
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // back-edge: ignore it rather than hang
    visiting.add(id);
    const prereqs = (byId.get(id)?.prereqs ?? []).filter((p) => byId.has(p));
    const value = prereqs.length === 0 ? 0 : 1 + Math.max(...prereqs.map(resolve));
    visiting.delete(id);
    depth[id] = value;
    return value;
  }

  for (const concept of map.concepts) resolve(concept.id);
  return depth;
}

export type ConceptLayout = Record<string, { x: number; y: number; width: number; tier: Tier }>;

/**
 * Positions for every concept, in columns by depth.
 *
 * Within a column the order is the average position of a concept's
 * prerequisites — the barycentre heuristic. It is one cheap pass and it is what
 * stops the edges crossing into an unreadable mesh; without it a column is in
 * whatever order the model happened to emit.
 */
export function layoutConcepts(map: ConceptMap, unlocks: Record<string, number>): ConceptLayout {
  const depth = depths(map);
  const columns = new Map<number, string[]>();
  for (const concept of map.concepts) {
    const d = depth[concept.id] ?? 0;
    columns.set(d, [...(columns.get(d) ?? []), concept.id]);
  }

  const byId = new Map(map.concepts.map((c) => [c.id, c]));
  const row: Record<string, number> = {};
  const out: ConceptLayout = {};

  for (const d of [...columns.keys()].sort((a, b) => a - b)) {
    const ids = columns.get(d)!;
    const ordered = [...ids].sort((a, b) => {
      const ba = barycentre(a);
      const bb = barycentre(b);
      if (ba !== bb) return ba - bb;
      // Deterministic, and puts the concepts that open up most nearest the top.
      const ua = unlocks[a] ?? 0;
      const ub = unlocks[b] ?? 0;
      if (ua !== ub) return ub - ua;
      return (byId.get(a)?.name ?? a).localeCompare(byId.get(b)?.name ?? b);
    });

    ordered.forEach((id, index) => {
      row[id] = index;
      const tier = sizeTier(unlocks[id] ?? 0);
      out[id] = {
        x: d * COL_W,
        y: index * (CARD_H + ROW_GAP),
        width: TIER_WIDTH[tier],
        tier,
      };
    });
  }

  return out;

  /** Mean row of this concept's already-placed prerequisites. */
  function barycentre(id: string): number {
    const placed = (byId.get(id)?.prereqs ?? [])
      .map((p) => row[p])
      .filter((r): r is number => r !== undefined);
    if (placed.length === 0) return Number.POSITIVE_INFINITY; // roots sink below
    return placed.reduce((sum, r) => sum + r, 0) / placed.length;
  }
}
