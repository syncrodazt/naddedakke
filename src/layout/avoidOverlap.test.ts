import { describe, expect, it } from 'vitest';
import { avoidOverlap, nodeRect, type Rect } from './layout';
import type { RNode } from '../model/types';

const size = { width: 360, height: 220 };

describe('avoidOverlap', () => {
  it('leaves a position that is already clear alone', () => {
    const at = avoidOverlap({ x: 0, y: 0 }, size, [{ x: 0, y: 900, width: 360, height: 200 }]);
    expect(at).toEqual({ x: 0, y: 0 });
  });

  it('slides below a card that rendered far taller than the estimate', () => {
    // The real bug: placement assumes ~220px, the answer above rendered 900,
    // so the new question landed inside it and was invisible.
    const tall: Rect = { x: 0, y: 0, width: 360, height: 900 };
    const at = avoidOverlap({ x: 0, y: 300 }, size, [tall]);
    expect(at.y).toBeGreaterThanOrEqual(900);
    expect(at.x).toBe(0); // only the vertical position gives way
  });

  it('keeps sliding past a stack of them', () => {
    const stack: Rect[] = [
      { x: 0, y: 0, width: 360, height: 600 },
      { x: 0, y: 680, width: 360, height: 600 },
    ];
    const at = avoidOverlap({ x: 0, y: 100 }, size, stack);
    expect(at.y).toBeGreaterThanOrEqual(1280);
  });

  it('ignores cards in another column', () => {
    // Sliding down past something the new node never touches would push
    // branches arbitrarily far from their parent.
    const at = avoidOverlap({ x: 0, y: 0 }, size, [{ x: 800, y: 0, width: 360, height: 900 }]);
    expect(at.y).toBe(0);
  });

  it('terminates on a pathological canvas instead of hanging', () => {
    const many: Rect[] = Array.from({ length: 400 }, (_, i) => ({
      x: 0,
      y: i * 10,
      width: 360,
      height: 300,
    }));
    expect(() => avoidOverlap({ x: 0, y: 0 }, size, many)).not.toThrow();
  });
});

describe('nodeRect', () => {
  const node = (id: string): RNode => ({
    id,
    sessionId: 's',
    kind: 'answer',
    seq: 1,
    position: { x: 10, y: 20 },
    content: { md: 'x', highlights: [] },
  });

  it('prefers what the canvas measured over the estimate', () => {
    expect(nodeRect(node('a'), { a: { width: 400, height: 950 } })).toEqual({
      x: 10,
      y: 20,
      width: 400,
      height: 950,
    });
  });

  it('falls back to the estimate before anything has been measured', () => {
    const r = nodeRect(node('a'));
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });
});
