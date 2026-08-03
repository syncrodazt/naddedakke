import { salvageStringField, stripFence } from '../services/jsonSalvage';

// Reading a generated figure out of a model reply.

export class VisualError extends Error {}

export type GeneratedVisual = {
  title: string;
  html: string;
  /** The figure asked for three.js. Only ever set by us, never by the model. */
  three: boolean;
};

/** A figure big enough to be one. Below this the reply is a stub or an apology. */
const MIN_HTML = 40;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Whether the figure needs three.js.
 *
 * Read off the code rather than taken from a flag the model sets, for the same
 * reason a source's kind is read off its host: the consequence of believing a
 * wrong answer is a blank box (three missing) or 700KB shipped for a bar chart
 * (three included for nothing), and the code itself cannot be wrong about what
 * it references.
 */
export function usesThree(html: string): boolean {
  return /\bTHREE\s*\./.test(html);
}

/** `<!-- title: ... -->` on the first line, which is how the figure is asked. */
const TITLE_COMMENT = /^\s*<!--\s*title:\s*([^]*?)\s*-->\s*/i;

/**
 * The figure in a reply, or a failure that says what came back instead.
 *
 * Three shapes are accepted, in order of how much they can be trusted:
 *
 * 1. A JSON envelope that parses.
 * 2. A JSON envelope that does NOT parse. This is the common case, not an edge
 *    case: a figure is a long program full of quotes and newlines, and models
 *    put real newlines inside the string constantly, which is invalid JSON.
 *    The field is scanned out by hand and unescaped, because the alternative —
 *    slicing the raw text — leaves `id=\"c\"` in the markup, and an attribute
 *    that never matches is a figure that dies on its first getElementById.
 * 3. A bare HTML fragment, which is what the prompt now asks for.
 */
export function parseVisual(raw: string, fallbackTitle: string): GeneratedVisual {
  let text = stripFence(raw);

  // Taken off the front before anything else: the raw-HTML path starts at the
  // first TAG, which would step straight over the comment and lose the title.
  let title = '';
  const leading = TITLE_COMMENT.exec(text);
  if (leading) {
    title = (leading[1] ?? '').trim();
    text = text.slice(leading[0].length);
  }

  let html = '';
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed) && typeof parsed.html === 'string') {
      html = parsed.html;
      title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
    }
  } catch {
    // Not valid JSON — but it may still BE an envelope. See (2) above.
  }

  if (html === '' && /"html"\s*:/.test(text)) {
    html = salvageStringField(text, 'html') ?? '';
    if (title === '') title = salvageStringField(text, 'title')?.trim() ?? '';
  }

  if (html === '') {
    // Take everything from the first tag on: models like to introduce the code
    // with a sentence, and that sentence is not part of the figure.
    const start = text.search(/<(?:!doctype|html|body|div|canvas|svg|style|script|p|h[1-6])\b/i);
    if (start !== -1) html = text.slice(start);
    // ...and drop a closing fence the model left after it.
    html = html.replace(/\s*```\s*$/, '');
  }

  // The same comment can arrive INSIDE an envelope's html value, where the
  // pass above could not have seen it.
  const titled = TITLE_COMMENT.exec(html);
  if (titled) {
    if (title === '') title = (titled[1] ?? '').trim();
    html = html.slice(titled[0].length);
  }

  html = html.trim();
  if (html.length < MIN_HTML) {
    const summary = raw.trim() === '' ? '(empty reply)' : raw.trim().slice(0, 160);
    throw new VisualError(`no figure in the reply: ${summary}`);
  }

  return {
    title: title === '' ? fallbackTitle : title,
    html,
    three: usesThree(html),
  };
}
