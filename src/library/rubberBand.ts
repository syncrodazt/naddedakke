export type Rect = { left: number; top: number; right: number; bottom: number };

/** The rectangle two pointer positions describe, in either drag direction. */
export function rectBetween(
  a: { x: number; y: number },
  b: { x: number; y: number },
): Rect & { width: number; height: number } {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const right = Math.max(a.x, b.x);
  const bottom = Math.max(a.y, b.y);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/**
 * Touching counts as covered — the same rule file managers use. A band that
 * required full containment would refuse to pick a card whose bottom edge is
 * one pixel below where you stopped dragging.
 */
export function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Ids of the cards the band currently covers. */
export function coveredIds(band: Rect, cards: { id: string; rect: Rect }[]): string[] {
  return cards.filter((c) => intersects(band, c.rect)).map((c) => c.id);
}

/**
 * Below this the gesture was a click, not a drag. Without it, the tiny movement
 * between pressing and releasing on empty space would register as a band that
 * covers nothing and clear the selection you meant to keep.
 */
export const DRAG_THRESHOLD_PX = 4;
