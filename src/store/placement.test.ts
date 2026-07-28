import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useGraphStore } from './graphStore';
import { setMetricsProvider } from '../layout/metrics';
import { nodeRect } from '../layout/layout';

function reset() {
  useGraphStore.setState({
    session: { id: 's', title: 't', mode: 'learn', createdAt: 0, seqCounter: 0 },
    nodes: {},
    edges: {},
    streamingNodeId: null,
    pendingQuestionId: null,
    computeIssues: {},
    lessonComplete: false,
  });
}

/** Every card reports itself as tall, the way a long model answer renders. */
function pretendEverythingIsTall(height = 900) {
  setMetricsProvider(() =>
    Object.fromEntries(
      Object.keys(useGraphStore.getState().nodes).map((id) => [id, { width: 360, height }]),
    ),
  );
}

const overlapping = () => {
  const nodes = Object.values(useGraphStore.getState().nodes);
  const metrics = Object.fromEntries(nodes.map((n) => [n.id, { width: 360, height: 900 }]));
  const rects = nodes.map((n) => ({ id: n.id, ...nodeRect(n, metrics) }));
  const clashes: string[] = [];
  for (const a of rects) {
    for (const b of rects) {
      if (a.id >= b.id) continue;
      const hit =
        a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
      if (hit) clashes.push(`${a.id}/${b.id}`);
    }
  }
  return clashes;
};

beforeEach(reset);
afterEach(() => setMetricsProvider(null));

describe('placing a new node', () => {
  it('clears a parent that rendered much taller than the estimate', () => {
    // The reported bug: ask a second question under a long answer and the new
    // question node lands inside it, invisible.
    const chunk = useGraphStore.getState().addChunk('## t\n\nbody with a highlight');
    pretendEverythingIsTall();
    const q = useGraphStore
      .getState()
      .addWhyBranch(chunk, { start: 0, end: 4, text: 'body' }, 'why');

    const { nodes } = useGraphStore.getState();
    expect(nodes[q]!.position.y).toBeGreaterThanOrEqual(900);
    expect(overlapping()).toEqual([]);
  });

  it('keeps several branches off one parent from stacking on each other', () => {
    const chunk = useGraphStore.getState().addChunk('## t\n\nbody one two');
    pretendEverythingIsTall();
    useGraphStore.getState().addWhyBranch(chunk, { start: 0, end: 3, text: 'one' }, 'why');
    useGraphStore.getState().addWhyBranch(chunk, { start: 4, end: 7, text: 'two' }, 'why');
    expect(overlapping()).toEqual([]);
  });

  it('keeps an answer clear of the question it replies to', () => {
    // Measured before branching, as in the app: a node has rendered by the time
    // the learner highlights text in it.
    const chunk = useGraphStore.getState().addChunk('## t\n\nbody');
    pretendEverythingIsTall();
    const q = useGraphStore
      .getState()
      .addWhyBranch(chunk, { start: 0, end: 4, text: 'body' }, 'why');
    useGraphStore.getState().submitQuestion(q, 'why?');
    expect(overlapping()).toEqual([]);
  });

  it('moves only the new node, never anything already placed', () => {
    // Re-running the layout would also fix the overlap — and would throw away
    // every position the learner had arranged.
    const chunk = useGraphStore.getState().addChunk('## t\n\nbody');
    useGraphStore.getState().setNodePosition(chunk, { x: 77, y: 88 });
    pretendEverythingIsTall();
    useGraphStore.getState().addWhyBranch(chunk, { start: 0, end: 4, text: 'body' }, 'why');
    expect(useGraphStore.getState().nodes[chunk]!.position).toEqual({ x: 77, y: 88 });
  });
});
