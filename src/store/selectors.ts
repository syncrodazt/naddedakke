import type { Edge, Node } from '@xyflow/react';
import type { REdge, RNode } from '../model/types';

// displayNum is the node's 1-based rank among currently-existing nodes (sorted
// by seq) — a contiguous number that renumbers after deletes. seq itself (the
// immutable chronological timeline) is still carried inside `node`.
export type RFlowNode = Node<{ node: RNode; displayNum: number }>;

const DEFAULT_NODE_WIDTH = 360;

export function toFlowNode(rnode: RNode, displayNum: number): RFlowNode {
  return {
    id: rnode.id,
    type: rnode.kind,
    position: rnode.position,
    data: { node: rnode, displayNum },
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

export function toFlowEdge(redge: REdge): Edge {
  return {
    id: redge.id,
    source: redge.source,
    target: redge.target,
    className: `edge-${redge.kind}`,
  };
}
