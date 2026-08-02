/**
 * Whether the event landed in something the learner is typing into.
 *
 * Every global key handler has to ask this first: an arrow key inside a compose
 * box moves the caret, and a Space inside one is a space. Shared so the answer
 * is the same everywhere rather than re-derived per handler.
 */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}
