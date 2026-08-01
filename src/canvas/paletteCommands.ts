// Actions you can reach from Ctrl/⌘+K by typing what you want to DO, rather
// than the name of a notebook.
//
// Kept separate from the palette component so the matching is testable on its
// own — it is the part that decides whether typing "new" gets you a new
// notebook or an unhelpful empty list.

/**
 * What someone might type to mean "new notebook". The English words stay
 * matchable in every interface language: they are what a keyboard reaches for
 * first, and someone typing "new" in a Thai UI still means new.
 */
export const NEW_KEYWORDS = [
  'new',
  'notebook',
  'create',
  'ใหม่',
  'โน้ตใหม่',
  'สร้าง',
  '新規',
  '新しい',
];

/**
 * Whether the query is reaching for "new notebook".
 *
 * Prefix matching, not substring: a topic like "neural networks" must not
 * surface the command, and "renew" is not a request to create anything.
 */
export function matchesNewCommand(query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return false;
  return NEW_KEYWORDS.some((k) => k.startsWith(needle));
}

/**
 * Which row a digit key jumps to, or null if the key means nothing here.
 *
 * Digits only jump while the search box is EMPTY. Once you have typed
 * something, a digit is part of what you are typing — a notebook called "1999"
 * has to be findable, and a shortcut that eats the keystroke would make it
 * unreachable. Empty box is also exactly the moment the shortcut is for: Ctrl+K
 * then 1 to reach the notebook you were just in.
 *
 * 1-based, because that is what the badge on the row says. There is no 0.
 */
export function digitTarget(key: string, query: string, rowCount: number): number | null {
  if (query.trim() !== '') return null;
  if (!/^[1-9]$/.test(key)) return null;
  const index = Number(key) - 1;
  return index < rowCount ? index : null;
}

/** How many rows can carry a digit badge. Keys 1-9; there is no 0. */
export const MAX_DIGIT_ROWS = 9;
