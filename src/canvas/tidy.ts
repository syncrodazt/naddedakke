import type { ReactFlowInstance } from '@xyflow/react';
import { useGraphStore } from '../store/graphStore';
import type { LayoutDirection } from '../layout/layout';

// Tidy, in one place. The toolbar menu and the keyboard shortcut both go
// through here so they cannot drift apart — in particular the metrics step,
// which is what stops tall cards being laid out as if they were short.

/** Remembered so the shortcut repeats whatever you last chose from the menu. */
const DIRECTION_KEY = 'nandedakke.tidyDirection';

export function lastTidyDirection(): LayoutDirection {
  try {
    return localStorage.getItem(DIRECTION_KEY) === 'vertical' ? 'vertical' : 'horizontal';
  } catch {
    return 'horizontal';
  }
}

function rememberDirection(direction: LayoutDirection): void {
  try {
    localStorage.setItem(DIRECTION_KEY, direction);
  } catch {
    // private mode — the shortcut just falls back to horizontal next session
  }
}

type Flow = Pick<ReactFlowInstance, 'getNodes' | 'getInternalNode' | 'fitView'>;

export function runTidy(flow: Flow, direction: LayoutDirection): void {
  rememberDirection(direction);
  // Feed Tidy the sizes React Flow measured on screen. Card heights are driven
  // by however much prose the model wrote, so laying out from an estimate is
  // what made tall cards overlap their branches.
  //
  // Measured sizes live on the *internal* node — getNodes() hands back the
  // controlled nodes we passed in, whose `measured` is always empty.
  const metrics = Object.fromEntries(
    flow.getNodes().map((n) => {
      const measured = flow.getInternalNode(n.id)?.measured;
      return [n.id, { width: measured?.width, height: measured?.height }];
    }),
  );
  useGraphStore.getState().tidyLayout(metrics, direction);
  // Let the position updates flush to React Flow before fitting.
  window.setTimeout(() => void flow.fitView({ duration: 500 }), 60);
}
