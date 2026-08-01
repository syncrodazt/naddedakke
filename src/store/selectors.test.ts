import { describe, expect, it } from 'vitest';
import { MarkerType } from '@xyflow/react';
import { toFlowEdge } from './selectors';
import { EDGE_KINDS, type REdge } from '../model/types';

function edge(kind: REdge['kind']): REdge {
  return { id: `e-${kind}`, sessionId: 's', kind, source: 'a', target: 'b' };
}

describe('toFlowEdge', () => {
  it('runs the spine and the dataflow side to side', () => {
    for (const kind of ['next', 'depends'] as const) {
      const out = toFlowEdge(edge(kind));
      expect(out.sourceHandle, kind).toBe('out-r');
      expect(out.targetHandle, kind).toBe('in-l');
    }
  });

  it('drops a branch straight out of the bottom of its parent', () => {
    // A question hangs BELOW the passage that provoked it. Leaving from the
    // right-hand side made the edge curve back round and pass behind the card
    // it came from.
    for (const kind of ['why', 'reply'] as const) {
      const out = toFlowEdge(edge(kind));
      expect(out.sourceHandle, kind).toBe('out-b');
      expect(out.targetHandle, kind).toBe('in-t');
      // Orthogonal, so it drops and squares off rather than sweeping across.
      expect(out.type, kind).toBe('smoothstep');
    }
  });

  it('gives every kind a defined route', () => {
    for (const kind of EDGE_KINDS) {
      const out = toFlowEdge(edge(kind));
      expect(out.sourceHandle, kind).toBeDefined();
      expect(out.targetHandle, kind).toBeDefined();
    }
  });

  it('keeps the arrow head and the per-kind class', () => {
    const out = toFlowEdge(edge('why'));
    expect(out.className).toBe('edge-why');
    expect(out.markerEnd).toMatchObject({ type: MarkerType.ArrowClosed });
  });
});
