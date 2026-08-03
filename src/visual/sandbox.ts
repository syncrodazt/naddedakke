// The document a generated visual runs inside.
//
// CLAUDE.md settled the shape of this before any of it was written: LLM-written
// interactive HTML goes in a sandboxed iframe with `allow-scripts` and NO
// same-origin, and never through dangerouslySetInnerHTML. Everything here
// exists to make that containment real rather than nominal.
//
// Escaping is deliberately NOT the defence. The model owns this whole document
// — it is supposed to write script tags — so there is nothing to break out of
// and nothing to sanitise. What stops it mattering is that the document has an
// opaque origin (no allow-same-origin), so its script cannot read our DOM, our
// IndexedDB, our cookies or our session, and a CSP that forbids every kind of
// network access, so it cannot send anything anywhere either.

/** Marks the messages our shim posts, so stray page messages are ignored. */
export const VISUAL_MESSAGE = 'rgraph-visual';

export type VisualMessage =
  | { source: typeof VISUAL_MESSAGE; kind: 'error'; message: string }
  | { source: typeof VISUAL_MESSAGE; kind: 'height'; height: number };

/**
 * Nothing may be fetched, connected to, or navigated to.
 *
 * `default-src 'none'` is the whole policy; the rest are the narrow holes a
 * self-contained figure genuinely needs. `connect-src 'none'` is the one that
 * matters most — it is what makes "this visual cannot phone home" a fact rather
 * than a hope, even though the sandbox already leaves it nothing worth sending.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  // Data and blob only: a figure may draw its own images, never load one.
  'img-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/**
 * Reported back to the card rather than swallowed.
 *
 * Generated code fails often enough that silence is the worst outcome: an empty
 * white box says nothing about whether the model wrote something broken, the
 * canvas is 0px tall, or nothing was generated at all. The height report exists
 * because a figure knows how tall it wants to be and a fixed box either crops
 * it or leaves a gap.
 */
const SHIM = `
<script>
(function () {
  var send = function (msg) {
    try { parent.postMessage(Object.assign({ source: ${JSON.stringify(VISUAL_MESSAGE)} }, msg), '*'); }
    catch (e) { /* nothing useful left to do */ }
  };
  window.onerror = function (message, src, line) {
    send({ kind: 'error', message: String(message) + (line ? ' (line ' + line + ')' : '') });
    return false;
  };
  window.addEventListener('unhandledrejection', function (e) {
    send({ kind: 'error', message: String(e.reason) });
  });
  var report = function () { send({ kind: 'height', height: document.documentElement.scrollHeight }); };
  window.addEventListener('load', report);
  if (window.ResizeObserver) new ResizeObserver(report).observe(document.documentElement);
})();
</script>`;

/**
 * The palette, handed in so a figure looks like it belongs to the notebook.
 *
 * The same fixed values as the app: CLAUDE.md keeps them constant forever so
 * old sessions still match, and a figure that invents its own colours would
 * read as a foreign object pasted onto the canvas.
 */
const BASE_STYLE = `
<style>
  :root {
    --bg: #EEF1F4; --card: #FFF; --ink: #12202E; --muted: #5B6B7B;
    --grid: #D5DDE4; --branch: #C2185B; --alias: #0B8F8C; --guard: #E8B923;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--card); color: var(--ink); }
  body {
    font: 13px/1.5 system-ui, -apple-system, "Helvetica Neue", sans-serif;
    padding: 10px;
  }
  canvas, svg { max-width: 100%; display: block; }
  input[type="range"] { width: 100%; accent-color: var(--alias); }
  button { font: inherit; cursor: pointer; }
</style>`;

export type SandboxOptions = {
  /** Full source of a library to define before the figure runs (three.js). */
  library?: string;
};

/**
 * The complete document for one visual.
 *
 * The library goes in before the shim so a failure inside it is still caught,
 * and the figure goes last so everything it needs already exists.
 */
export function buildSrcDoc(html: string, options: SandboxOptions = {}): string {
  const library =
    options.library === undefined || options.library === ''
      ? ''
      : `<script>${options.library}</script>`;
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    BASE_STYLE,
    SHIM,
    library,
    '</head><body>',
    html,
    '</body></html>',
  ].join('');
}

/**
 * A message that really came from one of our sandboxes.
 *
 * The origin cannot be checked — a document with no same-origin posts as
 * "null" — so identity is established by the message being from THIS iframe's
 * window, which the caller verifies, plus our own marker.
 */
export function readVisualMessage(data: unknown): VisualMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const msg = data as Record<string, unknown>;
  if (msg.source !== VISUAL_MESSAGE) return null;
  if (msg.kind === 'error') {
    return typeof msg.message === 'string'
      ? { source: VISUAL_MESSAGE, kind: 'error', message: msg.message.slice(0, 300) }
      : null;
  }
  if (msg.kind === 'height') {
    const height = msg.height;
    if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return null;
    // Capped: a runaway layout inside the figure must not be able to push the
    // card to a million pixels and take the canvas down with it.
    return { source: VISUAL_MESSAGE, kind: 'height', height: Math.min(Math.round(height), 2000) };
  }
  return null;
}
