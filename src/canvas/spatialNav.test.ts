import { describe, expect, it } from 'vitest';
import { nearestTo, nextInDirection, nodeAt } from './spatialNav';
import type { RNode } from '../model/types';
import { EST_H, NODE_W } from '../layout/layout';

// Nodes are NODE_W × EST_H unless sized, so a node at x is centred at
// x + NODE_W/2. Fixtures place nodes on a grid wide enough that the gaps are
// unambiguous.
function node(id: string, x: number, y: number, seq = 1): RNode {
  return {
    id,
    sessionId: 's',
    kind: 'chunk',
    seq,
    position: { x, y },
    content: { md: id, highlights: [] },
  };
}

function graph(...nodes: RNode[]): Record<string, RNode> {
  return Object.fromEntries(nodes.map((n) => [n.id, n]));
}

const COL = NODE_W + 200; // horizontal step
const ROW = EST_H + 200; // vertical step

describe('nextInDirection', () => {
  it('follows a left-to-right spine', () => {
    const g = graph(node('a', 0, 0, 1), node('b', COL, 0, 2), node('c', COL * 2, 0, 3));
    expect(nextInDirection(g, 'a', 'right')).toBe('b');
    expect(nextInDirection(g, 'b', 'right')).toBe('c');
    expect(nextInDirection(g, 'c', 'left')).toBe('b');
  });

  it('stops at the end instead of wrapping around', () => {
    // Wrapping would drop the reader on the far side of the canvas with no
    // idea how they got there.
    const g = graph(node('a', 0, 0, 1), node('b', COL, 0, 2));
    expect(nextInDirection(g, 'b', 'right')).toBeNull();
    expect(nextInDirection(g, 'a', 'left')).toBeNull();
    expect(nextInDirection(g, 'a', 'up')).toBeNull();
  });

  it('goes down into a branch and back up', () => {
    const g = graph(node('chunk', 0, 0, 1), node('question', 40, ROW, 2));
    expect(nextInDirection(g, 'chunk', 'down')).toBe('question');
    expect(nextInDirection(g, 'question', 'up')).toBe('chunk');
  });

  it('picks the nearer of several branches on the same parent', () => {
    // The case an edge-following model has no answer for: three questions off
    // one passage. Down goes to the one directly below.
    const g = graph(
      node('parent', 0, 0, 1),
      node('near', 20, ROW, 2),
      node('far', 20, ROW * 3, 3),
      node('aside', COL * 2, ROW, 4),
    );
    expect(nextInDirection(g, 'parent', 'down')).toBe('near');
  });

  // All nodes are the same default size, so a difference in position is also
  // the difference between their centres — offsets below are exact.
  it('ignores a node that is more beside you than ahead of you', () => {
    // `beside` is far closer, but it is 400 down for only 100 across: that is
    // not what pressing right means. Drop the cone and it wins.
    const g = graph(node('from', 0, 0, 1), node('ahead', 1000, 0, 2), node('beside', 100, 400, 3));
    expect(nextInDirection(g, 'from', 'right')).toBe('ahead');
  });

  it('prefers the node straight ahead over a nearer one at an angle', () => {
    // Both are inside the cone. `angled` is nearer along the axis (400 vs 500)
    // and only wins if drifting off-axis costs nothing.
    const g = graph(node('from', 0, 0, 1), node('ahead', 500, 0, 2), node('angled', 400, 390, 3));
    expect(nextInDirection(g, 'from', 'right')).toBe('ahead');
  });

  it('still reaches a node that is off to the side when nothing is ahead', () => {
    // Outside the cone, but it is the only thing to the right — refusing to
    // move would strand the reader.
    const g = graph(node('from', 0, 0, 1), node('offset', COL, ROW * 4, 2));
    expect(nextInDirection(g, 'from', 'right')).toBe('offset');
  });

  it('does not treat a node level with you as being ahead of you', () => {
    const g = graph(node('a', 0, 0, 1), node('b', 0, ROW, 2));
    expect(nextInDirection(g, 'a', 'right')).toBeNull();
    expect(nextInDirection(g, 'a', 'left')).toBeNull();
  });

  it('breaks a tie by seq, so the same key always gives the same answer', () => {
    const g = graph(node('from', 0, 0, 1), node('later', COL, 0, 9), node('earlier', COL, 0, 2));
    expect(nextInDirection(g, 'from', 'right')).toBe('earlier');
    expect(nextInDirection(g, 'from', 'right')).toBe('earlier');
  });

  it('measures from where nodes actually are, including resized ones', () => {
    // A tall card's centre sits lower; "down" from it must not pick something
    // its own body already covers.
    const tall = { ...node('tall', 0, 0, 1), size: { width: NODE_W, height: ROW * 3 } };
    const g = graph(tall, node('below', 0, ROW * 4, 2), node('inside', 0, ROW, 3));
    expect(nextInDirection(g, 'tall', 'down')).toBe('below');
  });

  it('honours measured sizes when they are supplied', () => {
    const g = graph(node('from', 0, 0, 1), node('other', 0, 400, 2));
    // With the default height the other node is below. Measured as very tall,
    // `from`'s centre drops past it and the answer flips to "up".
    const metrics = { from: { width: NODE_W, height: 2000 } };
    expect(nextInDirection(g, 'from', 'down')).toBe('other');
    expect(nextInDirection(g, 'from', 'up', metrics)).toBe('other');
  });

  it('returns null for a node that is not in the graph', () => {
    expect(nextInDirection(graph(node('a', 0, 0)), 'ghost', 'right')).toBeNull();
  });

  it('returns null when it is the only node', () => {
    const g = graph(node('a', 0, 0));
    for (const d of ['up', 'down', 'left', 'right'] as const) {
      expect(nextInDirection(g, 'a', d)).toBeNull();
    }
  });
});

describe('nearestTo', () => {
  it('finds the node closest to a point', () => {
    const g = graph(node('a', 0, 0, 1), node('b', COL * 4, 0, 2));
    expect(nearestTo(g, { x: 0, y: 0 })).toBe('a');
    expect(nearestTo(g, { x: COL * 4 + NODE_W, y: 0 })).toBe('b');
  });

  it('breaks ties by seq', () => {
    const g = graph(node('late', 0, 0, 8), node('early', 0, 0, 2));
    expect(nearestTo(g, { x: 0, y: 0 })).toBe('early');
  });

  it('returns null for an empty graph', () => {
    expect(nearestTo({}, { x: 0, y: 0 })).toBeNull();
  });
});

describe('nodeAt', () => {
  const g = graph(node('a', 0, 0, 1), node('b', COL, 0, 2));

  it('finds the card covering a point', () => {
    expect(nodeAt(g, { x: 10, y: 10 })).toBe('a');
    expect(nodeAt(g, { x: COL + 10, y: 10 })).toBe('b');
  });

  it('counts the card\u2019s own edges as covered', () => {
    expect(nodeAt(g, { x: 0, y: 0 })).toBe('a');
    expect(nodeAt(g, { x: NODE_W, y: EST_H })).toBe('a');
  });

  it('finds nothing in empty space', () => {
    expect(nodeAt(g, { x: -50, y: -50 })).toBeNull();
    expect(nodeAt(g, { x: NODE_W + 20, y: 0 })).toBeNull();
  });

  it('takes the topmost when cards overlap', () => {
    // The canvas stacks later cards over earlier ones, so a double-click on the
    // overlap must reach the one you can actually see.
    const stacked = graph(node('under', 0, 0, 1), node('over', 20, 20, 9));
    expect(nodeAt(stacked, { x: 40, y: 40 })).toBe('over');
  });

  it('respects a resized card', () => {
    const wide = { ...node('wide', 0, 0, 1), size: { width: NODE_W * 3, height: EST_H } };
    expect(nodeAt(graph(wide), { x: NODE_W * 2.5, y: 10 })).toBe('wide');
  });
});
