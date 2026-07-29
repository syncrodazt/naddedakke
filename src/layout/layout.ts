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

export type Rect = { x: number; y: number; width: number; height: number };

export function nodeRect(node: RNode, metrics?: NodeMetrics): Rect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: nodeWidth(node, metrics),
    height: nodeHeight(node, metrics),
  };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Slide a new node down until it sits clear of everything already on screen.
 *
 * Creation-time placement guesses a card's height, because the card does not
 * exist yet and prose height is whatever the model wrote. When the guess is
 * 220px and the node above it rendered at 900, the new question lands on top of
 * its own parent and is simply invisible.
 *
 * Only the new node moves. Re-running the whole layout would fix the overlap
 * too, but it would also throw away every position the learner had arranged.
 */
export function avoidOverlap(
  preferred: { x: number; y: number },
  size: { width: number; height: number },
  occupied: Rect[],
  gap: number = BRANCH_GAP_Y,
): { x: number; y: number } {
  let y = preferred.y;
  // Bounded: each step clears at least one rect, and a pathological canvas
  // must not hang the app.
  for (let guard = 0; guard < 500; guard += 1) {
    const candidate = { x: preferred.x, y, width: size.width, height: size.height };
    const hit = occupied.find((r) => overlaps(candidate, r));
    if (!hit) break;
    y = hit.y + hit.height + gap;
  }
  return { x: preferred.x, y };
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

export function nodeHeight(node: RNode, metrics?: NodeMetrics): number {
  const measured = metrics?.[node.id]?.height;
  if (measured !== undefined && measured > 0) return measured;
  if (node.size?.height !== undefined) return node.size.height;
  return COMPACT_KINDS.has(node.kind) ? COMPACT_H : EST_H;
}

export function nodeWidth(node: RNode, metrics?: NodeMetrics): number {
  const measured = metrics?.[node.id]?.width;
  if (measured !== undefined && measured > 0) return measured;
  return node.size?.width ?? NODE_W;
}

/**
 * Spine order: follow the `next` chain, not `seq`.
 *
 * They agree while chunks are only ever appended, which is why seq alone worked
 * for so long. They stop agreeing the moment a prerequisite is inserted BEFORE
 * an existing chunk: it is created later, so its seq is higher, but it belongs
 * to the left. seq is when the learner met an idea; the chain is where it sits
 * in the argument, and the canvas draws the argument.
 *
 * Nodes touched by no `next` edge keep seq order, appended after the chains.
 */
export function spineOrder(roots: RNode[], edges: REdge[]): RNode[] {
  const byId = new Map(roots.map((n) => [n.id, n]));
  const nextOf = new Map<string, string>();
  const hasPrev = new Set<string>();
  for (const e of edges) {
    if (e.kind !== 'next') continue;
    nextOf.set(e.source, e.target);
    hasPrev.add(e.target);
  }

  const out: RNode[] = [];
  const placed = new Set<string>();
  // Heads first, oldest chain first, so several spines stay in the order they
  // were started.
  const heads = roots.filter((n) => !hasPrev.has(n.id) && nextOf.has(n.id));
  for (const head of heads) {
    let cursor: string | undefined = head.id;
    while (cursor !== undefined && !placed.has(cursor)) {
      const node = byId.get(cursor);
      if (node) {
        out.push(node);
        placed.add(cursor);
      }
      cursor = nextOf.get(cursor);
    }
  }
  for (const node of roots) {
    if (!placed.has(node.id)) out.push(node);
  }
  return out;
}

/**
 * Which way the spine runs. Branches always come off it at a right angle, so
 * this is the whole difference: horizontal reads like a timeline, vertical like
 * a document you scroll.
 */
export type LayoutDirection = 'horizontal' | 'vertical';

export function computeLayout(
  nodes: Record<string, RNode>,
  edges: Record<string, REdge>,
  metrics?: NodeMetrics,
  direction: LayoutDirection = 'horizontal',
): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {};
  const edgeList = Object.values(edges);

  // The algorithm below is written in "along the spine" (main) and "across the
  // branches" (cross) terms, so both directions run the same packing code.
  // Only which screen axis each maps to — and therefore which of a card's two
  // dimensions matters — changes. Transposing finished positions instead would
  // overlap everything: a 360x900 card is not square.
  const vertical = direction === 'vertical';
  const mainSize = (n: RNode): number =>
    vertical ? nodeHeight(n, metrics) : nodeWidth(n, metrics);
  const crossSize = (n: RNode): number =>
    vertical ? nodeWidth(n, metrics) : nodeHeight(n, metrics);
  const setPos = (id: string, main: number, cross: number): void => {
    pos[id] = vertical ? { x: cross, y: main } : { x: main, y: cross };
  };

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
    mainStart: number,
    crossStart: number,
  ): { endCross: number; far: number } {
    let cross = crossStart;
    let far = mainStart + mainSize(nodes[rootId] as RNode);
    const visited = new Set<string>([rootId]);
    const place = (id: string, depth: number): void => {
      const node = nodes[id];
      if (!node || visited.has(id)) return;
      visited.add(id);
      const main = mainStart + depth * BRANCH_INDENT_X;
      setPos(id, main, cross);
      far = Math.max(far, main + mainSize(node));
      cross += crossSize(node) + BRANCH_GAP_Y;
      for (const { child, kind } of childrenOf(id)) {
        place(child.id, kind === 'why' ? depth + 1 : depth);
      }
    };
    for (const { child, kind } of childrenOf(rootId)) {
      place(child.id, kind === 'why' ? 1 : 0);
    }
    return { endCross: cross, far };
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
    let main = 0;
    for (const depth of [...columns.keys()].sort((a, b) => a - b)) {
      const columnNodes = (columns.get(depth) ?? []).sort((a, b) => a.seq - b.seq);
      let cross = SPINE_Y;
      let far = main;
      for (const node of columnNodes) {
        setPos(node.id, main, cross);
        far = Math.max(far, main + mainSize(node));
        if (childrenOf(node.id).length === 0) {
          cross += crossSize(node) + COLUMN_GAP_Y;
        } else {
          // Questions branched off this node stack directly beneath it, so the
          // column's next node starts past the whole subtree.
          const packed = packBranches(node.id, main, cross + crossSize(node) + BRANCH_TOP_GAP);
          cross = packed.endCross + COLUMN_GAP_Y;
          far = Math.max(far, packed.far);
        }
      }
      main = far + SPINE_GAP_X;
    }
  } else {
    // Learn: the spine left→right, branch subtree packed below each. The next
    // chunk starts past the widest point of the previous one's branch subtree,
    // so a deep or wide branch never collides with the next chunk.
    let main = 0;
    for (const spineNode of spineOrder(roots, edgeList)) {
      setPos(spineNode.id, main, SPINE_Y);
      const packed = packBranches(
        spineNode.id,
        main,
        SPINE_Y + crossSize(spineNode) + BRANCH_TOP_GAP,
      );
      main = packed.far + SPINE_GAP_X;
    }
  }

  // Any node not reached (e.g. orphaned) keeps its current position.
  for (const node of Object.values(nodes)) {
    if (!pos[node.id]) pos[node.id] = node.position;
  }
  return pos;
}
