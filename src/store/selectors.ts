import type { Edge, Node } from '@xyflow/react';
import type { REdge, RNode } from '../model/types';

export type RFlowNode = Node<{ node: RNode }>;

const DEFAULT_NODE_WIDTH = 360;

export function toFlowNode(rnode: RNode): RFlowNode {
  return {
    id: rnode.id,
    type: rnode.kind,
    position: rnode.position,
    data: { node: rnode },
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
