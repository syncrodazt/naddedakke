import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { REdge, RNode } from '../model/types';

// displayNum is the node's 1-based rank among currently-existing nodes (sorted
// by seq) — a contiguous number that renumbers after deletes. seq itself (the
// immutable chronological timeline) is still carried inside `node`.
export type RFlowNode = Node<{ node: RNode; displayNum: number }>;

const DEFAULT_NODE_WIDTH = 360;

// React Flow re-renders any node whose object identity changed. Dragging writes
// to the store on every pointer move, so rebuilding this array there would hand
// React Flow 200+ "new" nodes per frame when only one actually moved.
//
// Store updates are immutable, so an unchanged node is the very same RNode
// object — which makes it a usable cache key. A WeakMap also means entries for
// deleted nodes go away on their own.
const flowNodeCache = new WeakMap<RNode, RFlowNode>();

export function toFlowNode(rnode: RNode, displayNum: number, selected = false): RFlowNode {
  const cached = flowNodeCache.get(rnode);
  if (cached && cached.data.displayNum === displayNum && cached.selected === selected) {
    return cached;
  }
  const flow = buildFlowNode(rnode, displayNum, selected);
  flowNodeCache.set(rnode, flow);
  return flow;
}

function buildFlowNode(rnode: RNode, displayNum: number, selected: boolean): RFlowNode {
  return {
    id: rnode.id,
    type: rnode.kind,
    position: rnode.position,
    data: { node: rnode, displayNum },
    selected,
    dragHandle: '.drag-handle',
    // NodeResizer controls these once the user resizes; default width keeps
    // the card at its designed size, height stays auto until resized.
    width: rnode.size?.width ?? DEFAULT_NODE_WIDTH,
    height: rnode.size?.height,
    style: rnode.size
      ? { width: rnode.size.width, height: rnode.size.height }
      : { width: DEFAULT_NODE_WIDTH },
  };
}

// Every edge in this graph means something directional — the next step, the
// question a passage provoked, the value a formula reads — and without a head
// there is no way to tell which end is which once the canvas is arranged any
// way but left-to-right. Coloured to match its own line rather than left grey.
const ARROW_COLOR: Record<REdge['kind'], string> = {
  next: 'var(--muted)',
  why: 'var(--branch)',
  reply: 'var(--branch)',
  depends: 'var(--alias)',
};

// Where an edge leaves and arrives, by what it means.
//
// The spine and the dataflow run left to right, so those attach side to side.
// A question hangs below the passage that provoked it, so those leave the
// bottom and arrive at the top — a straight drop, instead of a curve out of the
// right-hand side that loops back behind the parent card.
const EDGE_PORTS: Record<REdge['kind'], { source: string; target: string; type: string }> = {
  next: { source: 'out-r', target: 'in-l', type: 'default' },
  depends: { source: 'out-r', target: 'in-l', type: 'default' },
  why: { source: 'out-b', target: 'in-t', type: 'smoothstep' },
  reply: { source: 'out-b', target: 'in-t', type: 'smoothstep' },
};

export function toFlowEdge(redge: REdge): Edge {
  const ports = EDGE_PORTS[redge.kind];
  return {
    id: redge.id,
    source: redge.source,
    target: redge.target,
    sourceHandle: ports.source,
    targetHandle: ports.target,
    type: ports.type,
    className: `edge-${redge.kind}`,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
      color: ARROW_COLOR[redge.kind],
    },
  };
}
