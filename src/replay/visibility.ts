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

// Interactive re-learn reveal: show the first `count` original nodes (seq <=
// baseSeq, in seq order) plus everything created since reveal began (seq >
// baseSeq — the learner's fresh branches). `originalTotal` is how many original
// nodes exist, so the UI knows when everything is revealed.
export function revealVisible(
  nodes: Record<string, RNode>,
  edges: Record<string, REdge>,
  baseSeq: number,
  count: number,
): { nodeIds: Set<string>; edgeIds: Set<string>; originalTotal: number } {
  const original = sortedBySeq(nodes).filter((n) => n.seq <= baseSeq);
  const revealedSeq = original[Math.max(0, count - 1)]?.seq ?? baseSeq;
  const nodeIds = new Set(
    Object.values(nodes)
      .filter((n) => n.seq <= revealedSeq || n.seq > baseSeq)
      .map((n) => n.id),
  );
  const edgeIds = new Set(
    Object.values(edges)
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => e.id),
  );
  return { nodeIds, edgeIds, originalTotal: original.length };
}
