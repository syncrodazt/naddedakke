import { describe, expect, it } from 'vitest';
import { buildExport, toRow } from './cloudSync';
import type { RNode, Session } from '../model/types';

const session: Session = {
  id: 'sess-1',
  title: 'Compound interest',
  mode: 'learn',
  createdAt: 1000,
  seqCounter: 3,
};

function chunk(id: string, seq: number): RNode {
  return {
    id,
    sessionId: 'sess-1',
    kind: 'chunk',
    seq,
    position: { x: 0, y: 0 },
    content: { md: id, highlights: [] },
  };
}

describe('buildExport', () => {
  it('returns null when there is no active session', () => {
    expect(buildExport({ session: null, nodes: {}, edges: {} })).toBeNull();
  });

  it('assembles a schema-versioned export with nodes sorted by seq', () => {
    const nodes = { b: chunk('b', 2), a: chunk('a', 1), c: chunk('c', 3) };
    const exp = buildExport({ session, nodes, edges: {} });
    expect(exp).not.toBeNull();
    expect(exp?.schemaVersion).toBe(1);
    expect(exp?.session).toEqual(session);
    expect(exp?.nodes.map((n) => n.seq)).toEqual([1, 2, 3]);
  });
});

describe('toRow', () => {
  it('maps a session export onto a Supabase row keyed by session id and owner', () => {
    const exp = buildExport({ session, nodes: { a: chunk('a', 1) }, edges: {} });
    const row = toRow(exp!, 'user-42', '2026-07-23T00:00:00.000Z');
    expect(row).toEqual({
      id: 'sess-1',
      user_id: 'user-42',
      title: 'Compound interest',
      updated_at: '2026-07-23T00:00:00.000Z',
      data: exp,
    });
  });
});
