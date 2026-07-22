import { describe, expect, it } from 'vitest';
import { exportSession, validateImport } from './exportImport';
import { fixture } from '../fixture/fixture';

function roundTrip(payload: unknown): unknown {
  return JSON.parse(JSON.stringify(payload));
}

describe('JSON export/import round-trip', () => {
  it('round-trips the fixture unchanged', () => {
    const nodes = Object.fromEntries(fixture.nodes.map((n) => [n.id, n]));
    const edges = Object.fromEntries(fixture.edges.map((e) => [e.id, e]));
    const exported = exportSession(fixture.session, nodes, edges);
    const imported = validateImport(roundTrip(exported));
    expect(imported.session).toEqual(fixture.session);
    expect(imported.nodes).toHaveLength(fixture.nodes.length);
    expect(imported.edges).toHaveLength(fixture.edges.length);
    for (const original of fixture.nodes) {
      expect(imported.nodes.find((n) => n.id === original.id)).toEqual(original);
    }
  });

  it('keeps highlight linkage intact', () => {
    const imported = validateImport(roundTrip(fixture));
    const chunk2 = imported.nodes.find((n) => n.id === 'fx-chunk-2')!;
    const highlight = chunk2.content.highlights[0]!;
    expect(highlight.childNodeId).toBe('fx-q-1');
    expect(chunk2.content.md.slice(highlight.start, highlight.end)).toBe(highlight.text);
    expect(imported.nodes.some((n) => n.id === highlight.childNodeId)).toBe(true);
  });

  it('exports nodes sorted by seq', () => {
    const nodes = Object.fromEntries([...fixture.nodes].reverse().map((n) => [n.id, n]));
    const exported = exportSession(fixture.session, nodes, {});
    const seqs = exported.nodes.map((n) => n.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it('rejects wrong schemaVersion', () => {
    expect(() => validateImport({ ...(roundTrip(fixture) as object), schemaVersion: 2 })).toThrow(
      /schemaVersion/,
    );
  });

  it('rejects unknown node kinds', () => {
    const bad = roundTrip(fixture) as { nodes: { kind: string }[] };
    bad.nodes[0]!.kind = 'mindmap';
    expect(() => validateImport(bad)).toThrow(/kind/);
  });

  it('rejects edges pointing at missing nodes', () => {
    const bad = roundTrip(fixture) as { edges: { target: string }[] };
    bad.edges[0]!.target = 'nope';
    expect(() => validateImport(bad)).toThrow(/target/);
  });

  it('rejects highlights with inverted offsets', () => {
    const bad = roundTrip(fixture) as {
      nodes: { content: { highlights: { start: number; end: number }[] } }[];
    };
    const withHl = bad.nodes.find((n) => n.content.highlights.length > 0)!;
    withHl.content.highlights[0]!.start = 50;
    withHl.content.highlights[0]!.end = 10;
    expect(() => validateImport(bad)).toThrow(/offsets/);
  });

  it('round-trips a playground node with key and params', () => {
    const imported = validateImport(roundTrip(fixture));
    const pg = imported.nodes.find((n) => n.kind === 'playground')!;
    expect(pg.playground).toEqual({ key: 'compound-curve', params: { rate: 6, years: 30 } });
  });

  it('rejects non-numeric playground params', () => {
    const bad = roundTrip(fixture) as {
      nodes: { kind: string; playground?: { params: Record<string, unknown> } }[];
    };
    const pg = bad.nodes.find((n) => n.kind === 'playground')!;
    pg.playground!.params.rate = 'six';
    expect(() => validateImport(bad)).toThrow(/playground/);
  });

  it('rejects non-objects', () => {
    expect(() => validateImport('[]')).toThrow(/invalid/);
    expect(() => validateImport(null)).toThrow(/invalid/);
  });
});
