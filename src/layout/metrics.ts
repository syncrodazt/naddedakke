import type { NodeMetrics } from './layout';

// How big the cards on screen actually are, right now.
//
// Only React Flow knows — height is whatever the rendered markdown came out to
// — but the store places new nodes and must not import the canvas. So the
// canvas registers a provider here and the store asks through it, the same
// shape of seam persistence uses for cloud sync.
//
// Without this, placement falls back to a fixed height estimate, and a new
// question lands underneath a long answer instead of below it.

let provider: (() => NodeMetrics) | null = null;

export function setMetricsProvider(fn: (() => NodeMetrics) | null): void {
  provider = fn;
}

/** Measured sizes, or an empty map before the canvas has mounted. */
export function currentMetrics(): NodeMetrics {
  return provider?.() ?? {};
}
