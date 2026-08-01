import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { EST_H, NODE_W } from '../layout/layout';
import { useGraphStore } from '../store/graphStore';
import { useSelectionStore } from './selectionStore';

/**
 * How close focusing brings a node. Capped: fitting one short card to the whole
 * window magnifies its text to absurdity.
 */
export const FOCUS_ZOOM = 1.6;
export const FOCUS_PADDING = 0.25;
/** A single deliberate press. */
export const FOCUS_MS = 500;
/** One of a run — arrows get held down, so the camera must keep up with them. */
export const STEP_MS = 260;

export function useCameraNav() {
  const { setCenter, fitView } = useReactFlow();

  /**
   * Land on a node: bring the camera in on it, and mark it focused.
   *
   * Fitting the node rather than centring at a fixed zoom is the point —
   * arriving somewhere you are zoomed out of leaves you looking at a card too
   * small to read, which is not arriving at all.
   *
   * `select` exists because React Flow marks a node focused itself when you
   * click it, and two writers disagreeing about the selection is worse than
   * either. Pass false when a click on the target is already doing that job;
   * keep it on when nothing was clicked (the arrow keys) or when the click was
   * on a DIFFERENT node (going back to the source of a question).
   */
  const zoomToNode = useCallback(
    (nodeId: string, duration = FOCUS_MS, { select = true }: { select?: boolean } = {}) => {
      if (!useGraphStore.getState().nodes[nodeId]) return;
      if (select) useSelectionStore.setState({ selected: new Set([nodeId]) });
      void fitView({
        nodes: [{ id: nodeId }],
        duration,
        maxZoom: FOCUS_ZOOM,
        padding: FOCUS_PADDING,
      });
    },
    [fitView],
  );

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

  /** Focus a node and briefly flash one of its highlight marks. */
  const panToHighlight = useCallback(
    (nodeId: string, highlightId: string) => {
      // Zoom rather than pan: "back to the original text" means going to read
      // it, and landing on an unreadable card does not answer that.
      zoomToNode(nodeId);
      window.setTimeout(() => {
        const mark = document.querySelector(
          `[data-node-id="${nodeId}"] mark[data-highlight-id="${highlightId}"]`,
        );
        if (!mark) return;
        mark.classList.add('flash');
        window.setTimeout(() => mark.classList.remove('flash'), 1600);
      }, 650);
    },
    [zoomToNode],
  );

  return { panToNode, panToHighlight, zoomToNode };
}
