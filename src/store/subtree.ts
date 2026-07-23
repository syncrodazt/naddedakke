import type { REdge } from '../model/types';

// Branch descendants of a node: everything reachable by following `why`
// (parent → question) and `reply` (question → answer) edges. Spine `next` edges
// and gyakusan `depends` edges are NOT followed — a chunk's siblings down the
// spine are not its descendants. The returned set always includes rootId.
export function collectSubtree(rootId: string, edges: Record<string, REdge>): Set<string> {
  const ids = new Set<string>([rootId]);
  const queue = [rootId];
  const edgeList = Object.values(edges);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const e of edgeList) {
      if (e.source === current && (e.kind === 'why' || e.kind === 'reply') && !ids.has(e.target)) {
        ids.add(e.target);
        queue.push(e.target);
      }
    }
  }
  return ids;
}
