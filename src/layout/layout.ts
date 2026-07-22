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

// ---- Full re-layout ("Tidy") -------------------------------------------------
// Recompute every node position for a learn-mode session so the chronological
// chain stays legible as it grows: spine nodes left→right by seq, and each
// node's branch subtree packed straight below it without overlap — 'why'
// branches indent one step deeper, 'reply' answers stay at their question's
// indent. seq is never touched; only positions change.

const BRANCH_TOP_GAP = BRANCH_GAP_Y; // gap between a spine node and its first branch

function nodeHeight(node: RNode): number {
  return node.size?.height ?? EST_H;
}

export function computeLayout(
  nodes: Record<string, RNode>,
  edges: Record<string, REdge>,
): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {};
  const edgeList = Object.values(edges);

  // Branch = target of a why/reply edge; everything else is on the spine.
  const branchTargets = new Set(
    edgeList.filter((e) => e.kind === 'why' || e.kind === 'reply').map((e) => e.target),
  );
  const spine = Object.values(nodes)
    .filter((n) => !branchTargets.has(n.id))
    .sort((a, b) => a.seq - b.seq);

  // children via why/reply, sorted by seq (chronological order within a branch).
  function childrenOf(id: string): { child: RNode; kind: 'why' | 'reply' }[] {
    return edgeList
      .filter((e) => e.source === id && (e.kind === 'why' || e.kind === 'reply'))
      .map((e) => ({ child: nodes[e.target], kind: e.kind as 'why' | 'reply' }))
      .filter((c): c is { child: RNode; kind: 'why' | 'reply' } => c.child !== undefined)
      .sort((a, b) => a.child.seq - b.child.seq);
  }

  spine.forEach((spineNode, i) => {
    const spineX = i * (NODE_W + SPINE_GAP_X);
    pos[spineNode.id] = { x: spineX, y: SPINE_Y };

    // Pre-order walk of the branch subtree, packing tightly by actual height.
    let y = SPINE_Y + nodeHeight(spineNode) + BRANCH_TOP_GAP;
    const visited = new Set<string>([spineNode.id]);
    const place = (id: string, depth: number): void => {
      const node = nodes[id];
      if (!node || visited.has(id)) return;
      visited.add(id);
      pos[id] = { x: spineX + depth * BRANCH_INDENT_X, y };
      y += nodeHeight(node) + BRANCH_GAP_Y;
      for (const { child, kind } of childrenOf(id)) {
        place(child.id, kind === 'why' ? depth + 1 : depth);
      }
    };
    for (const { child, kind } of childrenOf(spineNode.id)) {
      place(child.id, kind === 'why' ? 1 : 0);
    }
  });

  // Any node not reached (e.g. orphaned) keeps its current position.
  for (const node of Object.values(nodes)) {
    if (!pos[node.id]) pos[node.id] = node.position;
  }
  return pos;
}
