import type { NodeKind, RNode } from '../model/types';
import { headingOf } from '../markdown/heading';
import { sortedBySeq } from './visibility';

// The replay track list: every node of the session in seq order, each one
// marked reached or not yet reached.
//
// The list shows the whole shape of the session from the first beat — you can
// see there are twelve steps and that you are on the third — while the content
// of the steps you have not reached stays hidden. That is the point of replaying
// rather than reviewing single cards: the sequence IS the thing being learned,
// so it has to be visible, but revealing what step 9 says would spoil the run.

export type TimelineRow = {
  id: string;
  /** 1-based position on the timeline. Matches the #N badge on the node. */
  rank: number;
  kind: NodeKind;
  reached: boolean;
  /** The node the camera is on right now. */
  current: boolean;
  understood: boolean;
  /** Title — null until the row is reached, so an unreached row cannot spoil. */
  title: string | null;
};

/**
 * `titleOf` is injected because the learner may be reading a translation: the
 * title in the list has to be the one on the card, not the canonical body.
 */
export function timelineRows(
  nodes: Record<string, RNode>,
  cursor: number,
  titleOf: (node: RNode) => string = (node) => headingOf(node.content.md),
): TimelineRow[] {
  return sortedBySeq(nodes).map((node, i) => {
    const rank = i + 1;
    const reached = rank <= cursor;
    return {
      id: node.id,
      rank,
      kind: node.kind,
      reached,
      current: rank === cursor,
      // Understanding as of this point in the timeline. Replay answers "how did
      // my understanding build up", so a node the learner has not reached yet
      // must not already be wearing today's tick.
      understood: reached && (node.understood ?? false),
      title: reached ? titleOf(node) : null,
    };
  });
}

/**
 * Where a step lands.
 *
 * Clamped to 1, not 0: cursor 0 is an empty canvas, which is a state the
 * timeline passes through on the way in rather than somewhere to step back to.
 * Stepping past either end stays put — replay does not wrap, because wrapping
 * from the last node to the first would read as "the session restarted".
 */
export function stepCursor(cursor: number, delta: number, total: number): number {
  if (total === 0) return 0;
  return Math.min(Math.max(cursor + delta, 1), total);
}
