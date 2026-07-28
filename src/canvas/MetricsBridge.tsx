import { useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import { setMetricsProvider } from '../layout/metrics';

/**
 * Publishes measured card sizes to the store, which needs them to place a new
 * node clear of the ones already on screen.
 *
 * A component of its own, rendering nothing, because `useReactFlow` subscribes
 * to viewport state: calling it inside Canvas re-rendered the whole ReactFlow
 * subtree on every frame of a drag and measurably cost dropped frames. Here the
 * re-renders land on an empty component and cost nothing.
 */
export function MetricsBridge() {
  const { getNodes, getInternalNode } = useReactFlow();

  useEffect(() => {
    // Read lazily: sizes are only wanted at the moment a node is created.
    setMetricsProvider(() =>
      Object.fromEntries(
        getNodes().map((n) => {
          const measured = getInternalNode(n.id)?.measured;
          return [n.id, { width: measured?.width, height: measured?.height }];
        }),
      ),
    );
    return () => setMetricsProvider(null);
  }, [getNodes, getInternalNode]);

  return null;
}
