import { stripFence } from '../services/jsonSalvage';

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

/**
 * The figure in a reply, or a failure that says what came back instead.
 *
 * A plain HTML reply is accepted as well as the JSON one asked for. Models drop
 * the envelope on long code often enough that refusing would throw away good
 * figures over their packaging, and there is nothing to lose: the HTML is going
 * into a sandbox either way, so the envelope was never a safety measure.
 */
export function parseVisual(raw: string, fallbackTitle: string): GeneratedVisual {
  const text = stripFence(raw);

  let title = '';
  let html = '';
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed) && typeof parsed.html === 'string') {
      html = parsed.html;
      title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
    }
  } catch {
    // Not JSON — fall through to the raw-HTML path.
  }

  if (html === '') {
    // Take everything from the first tag on: models like to introduce the code
    // with a sentence, and that sentence is not part of the figure.
    const start = text.search(/<(?:!doctype|html|body|div|canvas|svg|style|script|p|h[1-6])\b/i);
    if (start !== -1) html = text.slice(start);
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
