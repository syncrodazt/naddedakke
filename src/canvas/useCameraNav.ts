import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { EST_H, NODE_W } from '../layout/layout';
import { useGraphStore } from '../store/graphStore';

export function useCameraNav() {
  const { setCenter } = useReactFlow();

  const panToNode = useCallback(
    (nodeId: string) => {
      const node = useGraphStore.getState().nodes[nodeId];
      if (!node) return;
      void setCenter(node.position.x + NODE_W / 2, node.position.y + EST_H / 2, {
        zoom: 1,
        duration: 600,
      });
    },
    [setCenter],
  );

  /** Pan to a node and briefly flash one of its highlight marks. */
  const panToHighlight = useCallback(
    (nodeId: string, highlightId: string) => {
      panToNode(nodeId);
      window.setTimeout(() => {
        const mark = document.querySelector(
          `[data-node-id="${nodeId}"] mark[data-highlight-id="${highlightId}"]`,
        );
        if (!mark) return;
        mark.classList.add('flash');
        window.setTimeout(() => mark.classList.remove('flash'), 1600);
      }, 650);
    },
    [panToNode],
  );

  return { panToNode, panToHighlight };
}
