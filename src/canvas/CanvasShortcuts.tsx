import { useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useGraphStore } from '../store/graphStore';
import { useSelectionStore } from './selectionStore';
import { useCameraNav } from './useCameraNav';
import { currentMetrics } from '../layout/metrics';
import { nearestTo, nextInDirection, type Direction } from './spatialNav';
import { lastTidyDirection, runTidy } from './tidy';

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

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

type Props = {
  /** Replay and read-only guests get navigation, but nothing that rearranges. */
  readOnly?: boolean;
};

export function CanvasShortcuts({ readOnly = false }: Props) {
  const flow = useReactFlow();
  const { panToNode } = useCameraNav();

  useEffect(() => {
    function focus(nodeId: string) {
      useSelectionStore.setState({ selected: new Set([nodeId]) });
      panToNode(nodeId);
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

      if (!readOnly && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault();
        runTidy(flow, lastTidyDirection());
        return;
      }

      const direction = ARROWS[e.key];
      if (!direction || e.shiftKey) return;
      e.preventDefault();

      const selected = [...useSelectionStore.getState().selected];
      if (selected.length !== 1) {
        // Nothing focused yet (or a multi-selection): start from whatever is in
        // the middle of the screen, not from the first node of the lesson —
        // that may be a long way from what the learner is looking at.
        const { x, y, zoom } = flow.getViewport();
        const center = {
          x: (window.innerWidth / 2 - x) / zoom,
          y: (window.innerHeight / 2 - y) / zoom,
        };
        const start = nearestTo(nodes, center, currentMetrics());
        if (start) focus(start);
        return;
      }

      const next = nextInDirection(nodes, selected[0]!, direction, currentMetrics());
      if (next) focus(next);
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flow, panToNode, readOnly]);

  return null;
}
