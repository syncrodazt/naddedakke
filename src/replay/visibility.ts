import type { REdge, RNode } from '../model/types';

// Replay reveals nodes strictly in seq order — seq is the single source of
// truth for "how my understanding actually built up". Edges draw in together
// with their target node (the later endpoint).

export function sortedBySeq(nodes: Record<string, RNode>): RNode[] {
  return Object.values(nodes).sort((a, b) => a.seq - b.seq);
}

export function visibleGraph(
  nodes: Record<string, RNode>,
  edges: Record<string, REdge>,
  revealCount: number,
): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const revealed = sortedBySeq(nodes).slice(0, Math.max(0, revealCount));
  const nodeIds = new Set(revealed.map((n) => n.id));
  const edgeIds = new Set(
    Object.values(edges)
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => e.id),
  );
  return { nodeIds, edgeIds };
}
