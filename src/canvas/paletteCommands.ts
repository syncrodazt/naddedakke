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
