import { beforeEach, describe, expect, it } from 'vitest';
import { useGraphStore } from './graphStore';
import { spineOrder } from '../layout/layout';

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

/** Chain of `n` appended chunks, as a normal lesson produces. */
function spine(n: number): string[] {
  const store = useGraphStore.getState();
  return Array.from({ length: n }, (_, i) => store.addChunk(`## ${i}\n\nbody`));
}

const chainOf = () => {
  const { nodes, edges } = useGraphStore.getState();
  return spineOrder(Object.values(nodes), Object.values(edges)).map((n) => n.id);
};

describe('insertPrerequisite', () => {
  beforeEach(reset);

  it('lands between the target and whatever came before it', () => {
    const [a, b, c] = spine(3);
    const pre = useGraphStore.getState().insertPrerequisite(b!);
    expect(chainOf()).toEqual([a, pre, b, c]);
  });

  it('becomes the new head when the target had nothing before it', () => {
    const [a, b] = spine(2);
    const pre = useGraphStore.getState().insertPrerequisite(a!);
    expect(chainOf()).toEqual([pre, a, b]);
  });

  it('never forks the spine — one incoming next edge per chunk', () => {
    const [, b] = spine(3);
    useGraphStore.getState().insertPrerequisite(b!);
    const incoming = new Map<string, number>();
    for (const e of Object.values(useGraphStore.getState().edges)) {
      if (e.kind === 'next') incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
    }
    expect([...incoming.values()].every((n) => n === 1)).toBe(true);
  });

  it('takes a new seq rather than rewinding to look older', () => {
    // seq records when the learner met an idea. Going back for a missing
    // prerequisite happened just now, and replay should show it happening.
    const [, b] = spine(2);
    const pre = useGraphStore.getState().insertPrerequisite(b!);
    const { nodes } = useGraphStore.getState();
    expect(nodes[pre]!.seq).toBeGreaterThan(nodes[b!]!.seq);
    expect(useGraphStore.getState().session!.seqCounter).toBe(3);
  });

  it('places it to the left, where the layout will put it anyway', () => {
    const [, b] = spine(2);
    const pre = useGraphStore.getState().insertPrerequisite(b!);
    const { nodes } = useGraphStore.getState();
    expect(nodes[pre]!.position.x).toBeLessThan(nodes[b!]!.position.x);
  });

  it('can be asked again on the prerequisite, walking further back', () => {
    const [a] = spine(1);
    const first = useGraphStore.getState().insertPrerequisite(a!);
    const second = useGraphStore.getState().insertPrerequisite(first);
    expect(chainOf()).toEqual([second, first, a]);
  });
});
