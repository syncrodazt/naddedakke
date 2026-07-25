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
const COLUMN_GAP_Y = 48; // gap between stacked nodes in a gyakusan column

// Gyakusan cards (a title plus a number/slider) are far shorter than a prose
// lesson card, so stacking them at EST_H leaves big empty holes.
const COMPACT_KINDS: ReadonlySet<RNode['kind']> = new Set(['variable', 'derived', 'goal']);
const COMPACT_H = 150;

/**
 * Rendered sizes measured by React Flow, keyed by node id. A lesson card's real
 * height depends entirely on how much prose the model wrote — it ranges from a
 * couple of hundred pixels to a couple of thousand — so laying out against a
 * fixed estimate makes tall cards overlap whatever is packed below them. The
 * caller passes what the canvas actually measured; the estimates below are only
 * the fallback for nodes that have never been rendered.
 */
export type NodeMetrics = Record<string, { width?: number; height?: number } | undefined>;

function nodeHeight(node: RNode, metrics?: NodeMetrics): number {
  const measured = metrics?.[node.id]?.height;
  if (measured !== undefined && measured > 0) return measured;
  if (node.size?.height !== undefined) return node.size.height;
  return COMPACT_KINDS.has(node.kind) ? COMPACT_H : EST_H;
}

function nodeWidth(node: RNode, metrics?: NodeMetrics): number {
  const measured = metrics?.[node.id]?.width;
  if (measured !== undefined && measured > 0) return measured;
  return node.size?.width ?? NODE_W;
}

export function computeLayout(
  nodes: Record<string, RNode>,
  edges: Record<string, REdge>,
  metrics?: NodeMetrics,
): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {};
  const edgeList = Object.values(edges);

  // Branch = target of a why/reply edge; everything else is a "root" that the
  // mode-specific pass positions (spine node in learn mode, dependency-layer
  // node in gyakusan).
  const branchTargets = new Set(
    edgeList.filter((e) => e.kind === 'why' || e.kind === 'reply').map((e) => e.target),
  );
  const roots = Object.values(nodes)
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

  /**
   * Pre-order walk of a root's branch subtree, packing tightly by actual
   * height. Returns the y just past the subtree (so callers can stack below it)
   * and the rightmost edge it reaches (so callers can place the next column
   * clear of it — deep branches indent, and a resized card can be wide).
   */
  function packBranches(
    rootId: string,
    x: number,
    startY: number,
  ): { endY: number; right: number } {
    let y = startY;
    let right = x + nodeWidth(nodes[rootId] as RNode, metrics);
    const visited = new Set<string>([rootId]);
    const place = (id: string, depth: number): void => {
      const node = nodes[id];
      if (!node || visited.has(id)) return;
      visited.add(id);
      const nodeX = x + depth * BRANCH_INDENT_X;
      pos[id] = { x: nodeX, y };
      right = Math.max(right, nodeX + nodeWidth(node, metrics));
      y += nodeHeight(node, metrics) + BRANCH_GAP_Y;
      for (const { child, kind } of childrenOf(id)) {
        place(child.id, kind === 'why' ? depth + 1 : depth);
      }
    };
    for (const { child, kind } of childrenOf(rootId)) {
      place(child.id, kind === 'why' ? 1 : 0);
    }
    return { endY: y, right };
  }

  const dependsEdges = edgeList.filter((e) => e.kind === 'depends');

  if (dependsEdges.length > 0) {
    // Gyakusan: a dataflow graph, so lay it out in dependency layers —
    // column = longest path of `depends` edges into the node, which puts
    // variables on the left and the goal on the right. Nodes untouched by any
    // depends edge (e.g. a disclaimer chunk) go in a trailing column.
    const incoming = new Map<string, string[]>();
    const connected = new Set<string>();
    for (const e of dependsEdges) {
      incoming.set(e.target, [...(incoming.get(e.target) ?? []), e.source]);
      connected.add(e.source);
      connected.add(e.target);
    }
    const depthCache = new Map<string, number>();
    const depthOf = (id: string, seen: Set<string> = new Set()): number => {
      const cached = depthCache.get(id);
      if (cached !== undefined) return cached;
      if (seen.has(id)) return 0; // cycle guard — engine reports it separately
      seen.add(id);
      const parents = incoming.get(id) ?? [];
      const depth =
        parents.length === 0 ? 0 : Math.max(...parents.map((p) => depthOf(p, seen))) + 1;
      depthCache.set(id, depth);
      return depth;
    };

    const columns = new Map<number, RNode[]>();
    const maxDepth = Math.max(
      0,
      ...roots.filter((n) => connected.has(n.id)).map((n) => depthOf(n.id)),
    );
    for (const node of roots) {
      const depth = connected.has(node.id) ? depthOf(node.id) : maxDepth + 1;
      columns.set(depth, [...(columns.get(depth) ?? []), node]);
    }

    // Walk depths in order so each column starts clear of the widest thing in
    // the one before it.
    let x = 0;
    for (const depth of [...columns.keys()].sort((a, b) => a - b)) {
      const columnNodes = (columns.get(depth) ?? []).sort((a, b) => a.seq - b.seq);
      let y = SPINE_Y;
      let right = x;
      for (const node of columnNodes) {
        pos[node.id] = { x, y };
        right = Math.max(right, x + nodeWidth(node, metrics));
        if (childrenOf(node.id).length === 0) {
          y += nodeHeight(node, metrics) + COLUMN_GAP_Y;
        } else {
          // Questions branched off this node stack directly beneath it, so the
          // column's next node starts past the whole subtree.
          const packed = packBranches(node.id, x, y + nodeHeight(node, metrics) + BRANCH_TOP_GAP);
          y = packed.endY + COLUMN_GAP_Y;
          right = Math.max(right, packed.right);
        }
      }
      x = right + SPINE_GAP_X;
    }
  } else {
    // Learn: chronological spine left→right, branch subtree packed below each.
    // The next chunk starts past the widest point of the previous one's branch
    // subtree, so a deep or wide branch never collides with the next chunk.
    let x = 0;
    for (const spineNode of roots) {
      pos[spineNode.id] = { x, y: SPINE_Y };
      const packed = packBranches(
        spineNode.id,
        x,
        SPINE_Y + nodeHeight(spineNode, metrics) + BRANCH_TOP_GAP,
      );
      x = packed.right + SPINE_GAP_X;
    }
  }

  // Any node not reached (e.g. orphaned) keeps its current position.
  for (const node of Object.values(nodes)) {
    if (!pos[node.id]) pos[node.id] = node.position;
  }
  return pos;
}
