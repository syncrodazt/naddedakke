import { describe, expect, it } from 'vitest';
import type { RNode } from '../model/types';
import { stepCursor, timelineRows } from './timeline';

function node(id: string, seq: number, over: Partial<RNode> = {}): RNode {
  return {
    id,
    sessionId: 's',
    kind: 'chunk',
    seq,
    position: { x: 0, y: 0 },
    content: { md: `# ${id}\n\nbody`, highlights: [] },
    ...over,
  } as RNode;
}

function graph(...nodes: RNode[]): Record<string, RNode> {
  return Object.fromEntries(nodes.map((n) => [n.id, n]));
}

describe('timelineRows', () => {
  it('lists every node in seq order, ranked from 1', () => {
    // Insertion order deliberately not seq order: the track list is the
    // chronology, and seq is the only thing that says what that is.
    const rows = timelineRows(graph(node('c', 30), node('a', 10), node('b', 20)), 0);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('ranks contiguously even when seq has gaps', () => {
    // seq never renumbers, so deletes leave holes. The rank shown has to match
    // the #N badge on the card, which is contiguous.
    const rows = timelineRows(graph(node('a', 4), node('b', 91)), 2);
    expect(rows.map((r) => r.rank)).toEqual([1, 2]);
  });

  it('marks rows at or before the cursor as reached', () => {
    const rows = timelineRows(graph(node('a', 1), node('b', 2), node('c', 3)), 2);
    expect(rows.map((r) => r.reached)).toEqual([true, true, false]);
  });

  it('withholds the title of a row that has not been reached', () => {
    // The whole reason to hide unreached nodes on the canvas: knowing what step
    // 3 says before arriving there is the spoiler replay exists to prevent.
    const rows = timelineRows(graph(node('a', 1), node('b', 2)), 1);
    expect(rows[0]!.title).toBe('a');
    expect(rows[1]!.title).toBeNull();
  });

  it('still shows how many steps there are, and of what kind', () => {
    // Locked, but not invisible: the shape of the run is the thing being
    // learned, so it is there from the first beat.
    const rows = timelineRows(graph(node('a', 1), node('q', 2, { kind: 'question' })), 1);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.kind).toBe('question');
  });

  it('marks exactly the node the camera is on as current', () => {
    const rows = timelineRows(graph(node('a', 1), node('b', 2), node('c', 3)), 2);
    expect(rows.map((r) => r.current)).toEqual([false, true, false]);
  });

  it('has no current row before the first beat', () => {
    const rows = timelineRows(graph(node('a', 1)), 0);
    expect(rows.every((r) => !r.current)).toBe(true);
  });

  it('counts understanding as of the cursor, not as of today', () => {
    // Replay answers "how did my understanding build up". A node the learner
    // has not reached yet must not already wear the tick it earned later.
    const nodes = graph(
      node('a', 1, { understood: true }),
      node('b', 2, { understood: true }),
      node('c', 3, { understood: true }),
    );
    const rows = timelineRows(nodes, 2);
    expect(rows.map((r) => r.understood)).toEqual([true, true, false]);
  });

  it('takes titles from the body the learner is reading', () => {
    // Injected, because a learner reading a translation needs the list to match
    // the cards rather than the canonical body.
    const rows = timelineRows(graph(node('a', 1)), 1, () => 'แปลแล้ว');
    expect(rows[0]!.title).toBe('แปลแล้ว');
  });

  it('is empty for an empty graph', () => {
    expect(timelineRows({}, 3)).toEqual([]);
  });
});

describe('stepCursor', () => {
  it('moves one node at a time in either direction', () => {
    expect(stepCursor(3, 1, 10)).toBe(4);
    expect(stepCursor(3, -1, 10)).toBe(2);
  });

  it('stops at the end rather than wrapping', () => {
    // Wrapping from the last node back to the first would read as "the session
    // started over", which is a different event from "that was the end".
    expect(stepCursor(10, 1, 10)).toBe(10);
  });

  it('stops at the first node rather than emptying the canvas', () => {
    // Cursor 0 is a blank canvas — somewhere replay passes through on the way
    // in, not somewhere to step back to.
    expect(stepCursor(1, -1, 10)).toBe(1);
    expect(stepCursor(0, -1, 10)).toBe(1);
  });

  it('stays inside the timeline when the graph shrank under it', () => {
    // A node can be deleted while replay is open.
    expect(stepCursor(9, 1, 4)).toBe(4);
  });

  it('has nowhere to go in an empty graph', () => {
    expect(stepCursor(0, 1, 0)).toBe(0);
  });
});
