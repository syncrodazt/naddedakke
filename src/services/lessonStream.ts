// Lesson chunks are asked for as ONE JSON object:
//
//   {"chunkTitle": string, "md": string, "checkQuestion": string, "done": boolean}
//
// CLAUDE.md asks for two things that pull against each other — structured output
// so nodes are well-formed, and live token streaming into the node. Streaming a
// JSON document naively would show the learner `{"chunkTitle":"複利…` one
// character at a time, which throws away the signature interaction.
//
// So this parses the JSON *as it streams* and emits only the `md` field's text,
// decoded. The learner sees markdown appear live; the caller still gets the
// structured fields when the stream ends.
//
// A provider that ignores the instruction and just writes markdown is not a
// failure: the parser notices the reply does not begin with an object and
// passes everything straight through, which is exactly the old behaviour.

export type LessonChunk = {
  chunkTitle: string;
  md: string;
  checkQuestion?: string;
  /** The model's signal that this was the last chunk of the lesson. */
  done?: boolean;
};

type Mode = 'unknown' | 'json' | 'raw';

/**
 * Text of the `md` field present in `buf` so far, with JSON escapes decoded.
 * `complete` is true once its closing quote has arrived.
 *
 * A trailing partial escape (a lone `\`, or `\u12`) is held back rather than
 * emitted wrong — the next delta completes it.
 */
export function mdSoFar(buf: string): { text: string; complete: boolean } {
  const key = /"md"\s*:\s*"/.exec(buf);
  if (!key) return { text: '', complete: false };

  let out = '';
  let i = key.index + key[0].length;
  while (i < buf.length) {
    const ch = buf[i]!;
    if (ch === '"') return { text: out, complete: true };
    if (ch !== '\\') {
      out += ch;
      i += 1;
      continue;
    }
    const esc = buf[i + 1];
    if (esc === undefined) break; // escape split across deltas
    if (esc === 'u') {
      if (i + 6 > buf.length) break; // \uXXXX split across deltas
      out += String.fromCharCode(parseInt(buf.slice(i + 2, i + 6), 16));
      i += 6;
      continue;
    }
    const simple: Record<string, string> = {
      n: '\n',
      t: '\t',
      r: '\r',
      b: '\b',
      f: '\f',
      '"': '"',
      '\\': '\\',
      '/': '/',
    };
    out += simple[esc] ?? esc;
    i += 2;
  }
  return { text: out, complete: false };
}

function asLessonChunk(value: unknown): LessonChunk | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  if (typeof o.md !== 'string' || o.md.trim() === '') return null;
  return {
    chunkTitle: typeof o.chunkTitle === 'string' ? o.chunkTitle.trim() : '',
    md: o.md,
    ...(typeof o.checkQuestion === 'string' && o.checkQuestion.trim() !== ''
      ? { checkQuestion: o.checkQuestion.trim() }
      : {}),
    ...(o.done === true ? { done: true } : {}),
  };
}

/**
 * Feed it stream deltas; it hands back the markdown to append to the node, and
 * at the end the structured chunk (or null if the reply was plain markdown).
 */
export class LessonStreamParser {
  private buf = '';
  private mode: Mode = 'unknown';
  private emitted = 0;

  /** Markdown that became available from this delta. May be ''. */
  push(delta: string): string {
    this.buf += delta;
    if (this.mode === 'unknown') {
      // Decide only once there is something to judge by. A ``` fence still
      // counts as JSON — the object follows it. Stay undecided while the buffer
      // is only a prefix of an opener ("``", "```jso"), or a half-arrived
      // language tag would be mistaken for prose and lock in raw mode.
      const head = this.buf.replace(/^[\s`]*/, '');
      const afterLang = head.replace(/^json\s*/i, '');
      const stillCouldBeFence = afterLang.length < 4 && 'json'.startsWith(afterLang.toLowerCase());
      if (afterLang === '' || stillCouldBeFence) return '';
      this.mode = afterLang.startsWith('{') ? 'json' : 'raw';
      if (this.mode === 'raw') {
        this.emitted = this.buf.length;
        return this.buf;
      }
    }
    if (this.mode === 'raw') {
      this.emitted = this.buf.length;
      return delta;
    }
    const { text } = mdSoFar(this.buf);
    if (text.length <= this.emitted) return '';
    const fresh = text.slice(this.emitted);
    this.emitted = text.length;
    return fresh;
  }

  /** Everything received, for the fallback path. */
  raw(): string {
    return this.buf;
  }

  /**
   * The structured chunk, or null when the reply was not a usable JSON object —
   * in which case the caller keeps whatever markdown was streamed.
   */
  finish(): LessonChunk | null {
    if (this.mode !== 'json') return null;
    const start = this.buf.indexOf('{');
    const end = this.buf.lastIndexOf('}');
    if (start === -1 || end <= start) {
      // Truncated mid-object (cut off, or aborted). The md text streamed so far
      // is still real, so hand it back rather than discarding the learner's chunk.
      const partial = mdSoFar(this.buf);
      return partial.text.trim() === '' ? null : { chunkTitle: '', md: partial.text };
    }
    try {
      return asLessonChunk(JSON.parse(this.buf.slice(start, end + 1)));
    } catch {
      const partial = mdSoFar(this.buf);
      return partial.text.trim() === '' ? null : { chunkTitle: '', md: partial.text };
    }
  }
}

/** The exact blockquote form the app's check-question parser looks for. */
export const CHECK_PREFIX = '> ❓ ';

/**
 * Final body for a chunk node: the markdown, with the comprehension check
 * appended in the one format `findCheckRange` recognises.
 *
 * Composing it here rather than asking the model to format it is the point of
 * the whole exercise — the Socratic check silently disappeared whenever the
 * model forgot the marker, wrote a different emoji, or dropped the blockquote.
 */
export function composeChunkMd(chunk: LessonChunk): string {
  const body = chunk.md.trimEnd();
  if (chunk.checkQuestion === undefined) return body;
  if (new RegExp(`^>\\s*❓`, 'm').test(body)) return body; // model already included one
  return `${body}\n\n${CHECK_PREFIX}${chunk.checkQuestion}`;
}
