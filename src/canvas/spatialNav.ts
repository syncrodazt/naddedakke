import type { RNode } from '../model/types';
import { nodeRect, type NodeMetrics } from '../layout/layout';

// Moving between nodes with the arrow keys.
//
// The obvious design is to follow edges — right goes to the next chunk, down
// goes into a branch. It falls apart on the exact case this graph is built for:
// several questions hanging off one passage. "Down" then has no single answer,
// and whichever one it picked would be a rule you had to learn and remember.
//
// So arrows move SPATIALLY: the nearest node in the direction you pressed. That
// question needs no rule — you press right and land on the node that is to the
// right, which is the one you were already looking at. It also survives dragging
// nodes around by hand, which an edge-following model would not: the picture on
// screen would stop matching the keys.

export type Direction = 'up' | 'down' | 'left' | 'right';

type Point = { x: number; y: number };

function centerOf(node: RNode, metrics?: NodeMetrics): Point {
  const rect = nodeRect(node, metrics);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * How far off-axis a candidate may drift before it stops counting as being "in
 * that direction". Perpendicular distance is penalised rather than ignored, so
 * a node straight ahead beats one at an angle even when the angled one is
 * physically closer.
 */
const CONE_PENALTY = 2;
/** Used only when nothing lies within the cone, so a lone outlier is reachable. */
const WIDE_PENALTY = 4;
/** Positions are floats; anything under this is the same place. */
const EPSILON = 0.5;

/**
 * The node an arrow key should move to, or null when there is nothing that way.
 *
 * Null matters: at the right-hand end of the spine, pressing right should do
 * nothing rather than wrap around to the far side of the canvas, which would
 * lose the reader completely.
 */
export function nextInDirection(
  nodes: Record<string, RNode>,
  fromId: string,
  direction: Direction,
  metrics?: NodeMetrics,
): string | null {
  const from = nodes[fromId];
  if (!from) return null;
  const origin = centerOf(from, metrics);

  let inCone: { id: string; score: number; seq: number } | null = null;
  let anywhere: { id: string; score: number; seq: number } | null = null;

  for (const node of Object.values(nodes)) {
    if (node.id === fromId) continue;
    const point = centerOf(node, metrics);
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;

    // Distance along the axis pressed, and how far off that axis it sits.
    const along =
      direction === 'right' ? dx : direction === 'left' ? -dx : direction === 'down' ? dy : -dy;
    const perpendicular = Math.abs(direction === 'left' || direction === 'right' ? dy : dx);
    if (along <= EPSILON) continue;

    const wide = { id: node.id, score: along + perpendicular * WIDE_PENALTY, seq: node.seq };
    if (anywhere === null || better(wide, anywhere)) anywhere = wide;

    // A 45° cone: past that, the node is more beside you than ahead of you.
    if (perpendicular > along) continue;
    const near = { id: node.id, score: along + perpendicular * CONE_PENALTY, seq: node.seq };
    if (inCone === null || better(near, inCone)) inCone = near;
  }

  return (inCone ?? anywhere)?.id ?? null;
}

/**
 * Ties are broken by seq — the order things were actually asked in. Without a
 * tie-break, two nodes at the same distance would swap places between renders
 * and the same key would give different answers.
 */
function better(a: { score: number; seq: number }, b: { score: number; seq: number }): boolean {
  if (Math.abs(a.score - b.score) > EPSILON) return a.score < b.score;
  return a.seq < b.seq;
}

/**
 * The node closest to a point — used to decide where arrow navigation starts
 * when nothing is focused yet. Starting from what is on screen beats starting
 * from the first node of the lesson, which may be nowhere near.
 */
export function nearestTo(
  nodes: Record<string, RNode>,
  point: Point,
  metrics?: NodeMetrics,
): string | null {
  let best: { id: string; distance: number; seq: number } | null = null;
  for (const node of Object.values(nodes)) {
    const center = centerOf(node, metrics);
    const distance = Math.hypot(center.x - point.x, center.y - point.y);
    if (best === null || distance < best.distance - EPSILON) {
      best = { id: node.id, distance, seq: node.seq };
    } else if (
      best !== null &&
      Math.abs(distance - best.distance) <= EPSILON &&
      node.seq < best.seq
    ) {
      best = { id: node.id, distance, seq: node.seq };
    }
  }
  return best?.id ?? null;
}
