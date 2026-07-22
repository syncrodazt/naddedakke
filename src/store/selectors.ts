import type { Edge, Node } from '@xyflow/react';
import type { REdge, RNode } from '../model/types';

export type RFlowNode = Node<{ node: RNode }>;

export function toFlowNode(rnode: RNode): RFlowNode {
  return {
    id: rnode.id,
    type: rnode.kind,
    position: rnode.position,
    data: { node: rnode },
    dragHandle: '.drag-handle',
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
