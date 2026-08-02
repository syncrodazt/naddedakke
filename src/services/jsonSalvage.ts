// Recovering structure from a model reply that did not quite arrive.
//
// Two failures happen often enough to be worth handling rather than reporting:
// the model wraps its JSON in a code fence, and a long reply runs out of budget
// mid-object — which makes the whole document unparseable even though most of
// the entries came back intact.

/** The model sometimes wraps JSON in a ``` fence; take what is inside. */
export function stripFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/```\s*$/, '')
    .trim();
}

/**
 * The complete `{...}` objects inside `"<key>": [ ... ]`, whatever follows them.
 *
 * Braces inside strings do not count, or a blurb containing one would end its
 * object early and produce nonsense.
 */
export function salvageArrayObjects(raw: string, key: string): unknown[] {
  const marker = raw.indexOf(`"${key}"`);
  const open = marker === -1 ? -1 : raw.indexOf('[', marker);
  if (open === -1) return [];

  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = open + 1; i < raw.length; i++) {
    const ch = raw[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try {
          out.push(JSON.parse(raw.slice(start, i + 1)));
        } catch {
          // A complete-looking object that still will not parse is skipped.
        }
        start = -1;
      }
    } else if (ch === ']' && depth === 0) break;
  }
  return out;
}
