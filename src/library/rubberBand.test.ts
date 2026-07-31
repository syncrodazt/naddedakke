import { describe, expect, it } from 'vitest';
import { coveredIds, intersects, rectBetween } from './rubberBand';

describe('rectBetween', () => {
  it('normalises a drag that goes up and to the left', () => {
    const down = { x: 100, y: 100 };
    const up = { x: 20, y: 40 };
    expect(rectBetween(down, up)).toEqual({
      left: 20,
      top: 40,
      right: 100,
      bottom: 100,
      width: 80,
      height: 60,
    });
  });

  it('gives the same rectangle whichever corner you started from', () => {
    const a = { x: 5, y: 9 };
    const b = { x: 40, y: 60 };
    expect(rectBetween(a, b)).toEqual(rectBetween(b, a));
  });
});

describe('intersects', () => {
  const card = { left: 100, top: 100, right: 200, bottom: 160 };

  it('covers a card the band overlaps at a corner', () => {
    expect(intersects({ left: 190, top: 150, right: 300, bottom: 300 }, card)).toBe(true);
  });

  it('covers a card the band merely clips, not only ones it contains', () => {
    expect(intersects({ left: 0, top: 120, right: 1000, bottom: 130 }, card)).toBe(true);
  });

  it('does not cover a card the band stops short of', () => {
    expect(intersects({ left: 0, top: 0, right: 99, bottom: 500 }, card)).toBe(false);
    expect(intersects({ left: 0, top: 161, right: 500, bottom: 400 }, card)).toBe(false);
  });

  it('treats a shared edge as not covered', () => {
    expect(intersects({ left: 0, top: 0, right: 100, bottom: 500 }, card)).toBe(false);
  });
});

describe('coveredIds', () => {
  const cards = [
    { id: 'a', rect: { left: 0, top: 0, right: 100, bottom: 80 } },
    { id: 'b', rect: { left: 120, top: 0, right: 220, bottom: 80 } },
    { id: 'c', rect: { left: 0, top: 100, right: 100, bottom: 180 } },
  ];

  it('returns exactly the cards under the band, in list order', () => {
    const band = { left: 50, top: 50, right: 150, bottom: 120 };
    expect(coveredIds(band, cards)).toEqual(['a', 'b', 'c']);
  });

  it('returns nothing for a band over empty space', () => {
    expect(coveredIds({ left: 300, top: 300, right: 400, bottom: 400 }, cards)).toEqual([]);
  });

  it('picks a single card when the band stays inside one column', () => {
    expect(coveredIds({ left: 10, top: 105, right: 60, bottom: 150 }, cards)).toEqual(['c']);
  });
});
