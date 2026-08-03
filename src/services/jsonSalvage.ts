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

/**
 * One string field out of JSON that will not parse.
 *
 * Models routinely emit a long code string with REAL newlines inside it, which
 * is invalid JSON — `JSON.parse` refuses the whole document over it. Scanning
 * for the field by hand recovers the value, because the only thing that makes
 * it invalid is a character this scanner is happy to read.
 *
 * The escapes are undone here too. Getting that wrong is not cosmetic: an
 * `id=\"c\"` that reaches the page makes `getElementById` return null, and the
 * figure dies on its first line.
 */
export function salvageStringField(raw: string, key: string): string | null {
  const marker = raw.indexOf(`"${key}"`);
  if (marker === -1) return null;
  const colon = raw.indexOf(':', marker + key.length + 2);
  if (colon === -1) return null;
  const open = raw.indexOf('"', colon + 1);
  if (open === -1) return null;

  let out = '';
  for (let i = open + 1; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch === '"') return out; // unescaped quote ends the value
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = raw[++i];
    if (next === undefined) break;
    if (next === 'n') out += '\n';
    else if (next === 't') out += '\t';
    else if (next === 'r') out += '\r';
    else if (next === 'b') out += '\b';
    else if (next === 'f') out += '\f';
    else if (next === 'u') {
      const hex = raw.slice(i + 1, i + 5);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
      } else {
        out += next;
      }
    } else {
      // \" \\ \/ and anything else: the character itself.
      out += next;
    }
  }
  return null; // never closed — not a value we can trust
}
