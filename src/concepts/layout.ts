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

/** Vertical space between two subject bands, and the room a band label needs. */
export const BAND_GAP = 56;
export const BAND_LABEL_H = 30;
/** Slack around the cards inside a band's background. */
export const BAND_PAD = 18;

export type ConceptLayout = Record<string, { x: number; y: number; width: number; tier: Tier }>;

export type Band = {
  area: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TreeLayout = { positions: ConceptLayout; bands: Band[] };

/**
 * Positions for every concept: depth across, subject down.
 *
 * The first version put all fourteen concepts into two enormous columns, and
 * the edges between them became a bundle nobody could trace back to a source.
 * The fix is not prettier curves, it is grouping: split the rows into a band
 * per subject and almost every prerequisite edge becomes a short hop inside one
 * band. The few that cross bands are then the genuinely interesting ones — the
 * same idea showing up in another field.
 *
 * Depth still sets x globally, so the whole picture reads left to right as
 * foundations → what they open up, however many bands it has.
 */
export function layoutConcepts(map: ConceptMap, unlocks: Record<string, number>): TreeLayout {
  const depth = depths(map);
  const byId = new Map(map.concepts.map((c) => [c.id, c]));

  // Bands are ordered by the leverage they contain, so the subject worth
  // starting on is the one at the top of the screen.
  const areas = [...new Set(map.concepts.map((c) => c.area))].sort((a, b) => {
    const la = leverageOf(a);
    const lb = leverageOf(b);
    if (la !== lb) return lb - la;
    return a.localeCompare(b);
  });

  // The rightmost edge any card reaches, so every lane can be the same length.
  const fullWidth = Math.max(
    0,
    ...map.concepts.map(
      (c) => (depth[c.id] ?? 0) * COL_W + TIER_WIDTH[sizeTier(unlocks[c.id] ?? 0)],
    ),
  );

  const positions: ConceptLayout = {};
  const bands: Band[] = [];
  const row: Record<string, number> = {};
  let bandTop = 0;

  for (const area of areas) {
    const members = map.concepts.filter((c) => c.area === area);
    const columns = new Map<number, string[]>();
    for (const concept of members) {
      const d = depth[concept.id] ?? 0;
      columns.set(d, [...(columns.get(d) ?? []), concept.id]);
    }

    let rowsInBand = 0;

    for (const d of [...columns.keys()].sort((a, b) => a - b)) {
      const ordered = [...columns.get(d)!].sort((a, b) => {
        const ba = barycentre(a);
        const bb = barycentre(b);
        if (ba !== bb) return ba - bb;
        const ua = unlocks[a] ?? 0;
        const ub = unlocks[b] ?? 0;
        if (ua !== ub) return ub - ua;
        return (byId.get(a)?.name ?? a).localeCompare(byId.get(b)?.name ?? b);
      });

      ordered.forEach((id, index) => {
        row[id] = index;
        const tier = sizeTier(unlocks[id] ?? 0);
        const x = d * COL_W;
        positions[id] = {
          x,
          y: bandTop + BAND_LABEL_H + index * (CARD_H + ROW_GAP),
          width: TIER_WIDTH[tier],
          tier,
        };
      });
      rowsInBand = Math.max(rowsInBand, ordered.length);
    }

    const height = BAND_LABEL_H + rowsInBand * (CARD_H + ROW_GAP) - ROW_GAP + BAND_PAD;
    bands.push({
      area,
      // Every band spans the full width of the map, whatever it happens to
      // contain. Ragged boxes read as decoration around some cards; equal lanes
      // read as the zones they are, and the empty right-hand end of a short
      // band is itself information — that subject stops early.
      x: -BAND_PAD,
      y: bandTop - BAND_PAD / 2,
      width: fullWidth + BAND_PAD * 2,
      height: height + BAND_PAD / 2,
    });
    bandTop += height + BAND_GAP;
  }

  return { positions, bands };

  /** Mean row of this concept's already-placed prerequisites. */
  function barycentre(id: string): number {
    const placed = (byId.get(id)?.prereqs ?? [])
      .map((p) => row[p])
      .filter((r): r is number => r !== undefined);
    if (placed.length === 0) return Number.POSITIVE_INFINITY; // roots sink below
    return placed.reduce((sum, r) => sum + r, 0) / placed.length;
  }

  function leverageOf(area: string): number {
    return map.concepts
      .filter((c) => c.area === area)
      .reduce((sum, c) => sum + (unlocks[c.id] ?? 0), 0);
  }
}
