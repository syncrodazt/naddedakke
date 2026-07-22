import { describe, expect, it } from 'vitest';
import { examples } from './examples';
import { validateImport } from '../db/exportImport';

describe('example fixtures', () => {
  it('each example passes import validation and round-trips', () => {
    for (const ex of examples) {
      const parsed = validateImport(JSON.parse(JSON.stringify(ex.data)));
      expect(parsed.session.id).toBe(ex.id);
      expect(parsed.nodes.length).toBeGreaterThan(0);
    }
  });

  it('every highlight anchors to the exact text it stores', () => {
    for (const ex of examples) {
      for (const node of ex.data.nodes) {
        for (const h of node.content.highlights) {
          expect(node.content.md.slice(h.start, h.end)).toBe(h.text);
          // and it links to a real child node
          expect(ex.data.nodes.some((n) => n.id === h.childNodeId)).toBe(true);
        }
      }
    }
  });

  it('exposes distinct ids and includes the Thai and English examples', () => {
    const ids = examples.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('example-th-mp3');
    expect(ids).toContain('example-en-sky');
  });
});
