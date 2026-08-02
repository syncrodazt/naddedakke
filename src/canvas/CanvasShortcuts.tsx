import { useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { RNode } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { useSelectionStore } from './selectionStore';
import { FOCUS_MS, STEP_MS, useCameraNav } from './useCameraNav';
import { currentMetrics } from '../layout/metrics';
import { nearestTo, nextInDirection, type Direction } from './spatialNav';
import { lastTidyDirection, runTidy } from './tidy';
import { isTyping } from './isTyping';
import { useReplayStore } from '../replay/replayStore';

// Canvas keyboard shortcuts.
//
// Renders null and owns `useReactFlow()` on purpose: that hook re-renders its
// component on viewport changes, and putting it inside Canvas once cost 8% of
// frames during a drag. Same reason MetricsBridge exists.
//
// Key choice. Anything with Ctrl is a minefield in a browser — Ctrl+1..9 switch
// tabs and cannot be intercepted, Ctrl+T/N/W are gone entirely — so these use
// Shift plus a letter or digit, which no browser claims and which is what
// canvas tools (Figma, Miro) already use for exactly these two actions.

const ARROWS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

type Props = {
  /** Replay and read-only guests get navigation, but nothing that rearranges. */
  readOnly?: boolean;
};

export function CanvasShortcuts({ readOnly = false }: Props) {
  const flow = useReactFlow();
  const { zoomToNode } = useCameraNav();

  useEffect(() => {
    /**
     * Where keyboard navigation starts when nothing is focused: whatever is in
     * the middle of the screen, not the first node of the lesson — that may be
     * a long way from what the learner is looking at.
     */
    function nearestToViewportCentre(nodes: Record<string, RNode>): string | null {
      const { x, y, zoom } = flow.getViewport();
      const centre = {
        x: (window.innerWidth / 2 - x) / zoom,
        y: (window.innerHeight / 2 - y) / zoom,
      };
      return nearestTo(nodes, centre, currentMetrics());
    }

    function onKey(e: KeyboardEvent) {
      // Never steal a key from a compose box, and never from a real browser
      // shortcut the learner meant for the browser.
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;

      const nodes = useGraphStore.getState().nodes;
      if (Object.keys(nodes).length === 0) return;

      if (e.key === 'Escape') {
        useSelectionStore.getState().clear();
        return;
      }

      if (e.shiftKey && (e.key === '1' || e.key === '!')) {
        e.preventDefault();
        void flow.fitView({ duration: 500 });
        return;
      }

      // Zoom into whatever is focused. The counterpart to Shift+1: one shows
      // you the whole argument, this one shows you the passage.
      if (e.shiftKey && (e.key === '2' || e.key === '@')) {
        e.preventDefault();
        const [only] = [...useSelectionStore.getState().selected];
        const target = only ?? nearestToViewportCentre(nodes);
        if (!target) return;
        // Same move the arrows make, just deliberately slower: this one is a
        // single considered press rather than one of a run.
        zoomToNode(target, FOCUS_MS);
        return;
      }

      if (!readOnly && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault();
        runTidy(flow, lastTidyDirection());
        return;
      }

      const direction = ARROWS[e.key];
      if (!direction || e.shiftKey) return;
      // During replay the arrows belong to the track list: they step along the
      // timeline. Moving focus around the canvas as well would fight it.
      if (useReplayStore.getState().active) return;
      e.preventDefault();

      const selected = [...useSelectionStore.getState().selected];
      if (selected.length !== 1) {
        const start = nearestToViewportCentre(nodes);
        if (start) zoomToNode(start, STEP_MS);
        return;
      }

      const next = nextInDirection(nodes, selected[0]!, direction, currentMetrics());
      if (next) zoomToNode(next, STEP_MS);
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flow, zoomToNode, readOnly]);

  return null;
}
