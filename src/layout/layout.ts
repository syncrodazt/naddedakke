import type { REdge, RNode } from '../model/types';

// Layout position is separate from chronological order (seq) — positions are
// computed once at node creation and then owned by the node; user drags overwrite.
export const NODE_W = 360;
export const SPINE_GAP_X = 120;
export const SPINE_Y = 0;
export const BRANCH_GAP_Y = 80;
export const BRANCH_INDENT_X = 48;
export const EST_H = 220;

export function spinePosition(chunkIndex: number): { x: number; y: number } {
  return { x: chunkIndex * (NODE_W + SPINE_GAP_X), y: SPINE_Y };
}

/** Number of 'why' edges on the path from this node up to the spine. */
export function branchDepth(nodeId: string, edges: Record<string, REdge>): number {
  let depth = 0;
  let current = nodeId;
  const all = Object.values(edges);
  for (let guard = 0; guard < 1000; guard++) {
    const incoming = all.find(
      (e) => e.target === current && (e.kind === 'why' || e.kind === 'reply'),
    );
    if (!incoming) return depth;
    if (incoming.kind === 'why') depth++;
    current = incoming.source;
  }
  return depth;
}

/** Count of existing why-children of the parent, for sibling stacking. */
export function whySiblingCount(parentId: string, edges: Record<string, REdge>): number {
  return Object.values(edges).filter((e) => e.source === parentId && e.kind === 'why').length;
}

export function branchPosition(
  parent: RNode,
  depth: number,
  siblingIndex: number,
): { x: number; y: number } {
  return {
    x: parent.position.x + depth * BRANCH_INDENT_X,
    y: parent.position.y + EST_H + BRANCH_GAP_Y + siblingIndex * (EST_H + BRANCH_GAP_Y),
  };
}

/** Answer sits directly below its question so the pair reads as one vertical run. */
export function answerPosition(question: RNode): { x: number; y: number } {
  return {
    x: question.position.x,
    y: question.position.y + EST_H * 0.8 + BRANCH_GAP_Y / 2,
  };
}
