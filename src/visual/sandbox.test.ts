import { describe, expect, it } from 'vitest';
// Read through Vite rather than node:fs — this file is compiled with the app's
// tsconfig, which has no Node types, and ?raw is the same content either way.
import visualNodeSource from './VisualNode.tsx?raw';
import { VISUAL_MESSAGE, buildSrcDoc, readVisualMessage } from './sandbox';

describe('buildSrcDoc', () => {
  const doc = buildSrcDoc('<canvas id="c"></canvas><script>draw()</script>');

  it('forbids every route out of the sandbox', () => {
    // This is the containment, so each of these is load-bearing rather than
    // decorative. `connect-src 'none'` is what makes "a figure cannot phone
    // home" a fact instead of a hope.
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("connect-src 'none'");
    expect(doc).toContain("form-action 'none'");
    expect(doc).toContain("base-uri 'none'");
  });

  it('lets a figure draw, but never load', () => {
    // Inline script and style are the whole point; an external image or font
    // would be a network request from code we did not write.
    expect(doc).toContain("script-src 'unsafe-inline'");
    expect(doc).toContain('img-src data: blob:');
    expect(doc).not.toMatch(/img-src[^;]*https/);
    expect(doc).not.toMatch(/script-src[^;]*https/);
  });

  it('keeps the code of the figure exactly as written', () => {
    // No sanitising, deliberately. Rewriting it would be a lie about where the
    // safety comes from, and would silently break working figures.
    expect(doc).toContain('<canvas id="c"></canvas><script>draw()</script>');
  });

  it('installs the error and height channel before the figure runs', () => {
    // A figure that throws on its first line must still be reportable.
    expect(doc.indexOf('window.onerror')).toBeLessThan(doc.indexOf('<body>'));
    expect(doc).toContain('unhandledrejection');
    expect(doc).toContain(VISUAL_MESSAGE);
  });

  it('defines the palette so a figure matches the notebook', () => {
    expect(doc).toContain('--branch: #C2185B');
    expect(doc).toContain('--alias: #0B8F8C');
  });

  it('puts a library in before the figure that needs it', () => {
    const withLib = buildSrcDoc('<div id="x"></div>', { library: 'var THREE={};' });
    expect(withLib.indexOf('var THREE={};')).toBeLessThan(withLib.indexOf('<div id="x">'));
  });

  it('adds no library tag when there is none', () => {
    expect(doc).not.toContain('<script></script>');
  });
});

// The iframe attribute is the other half of the containment, and it lives in a
// component rather than in a function that can be called. Reading the source is
// blunt, but a security property this cheap to break silently deserves a guard
// that fails loudly.
describe('the iframe never gets its own origin back', () => {
  const source = visualNodeSource;

  // Every sandbox attribute in the file, so a second iframe added later cannot
  // quietly be laxer than this one. Matched on the attribute rather than the
  // bare word, so the comments are free to name what they are guarding against.
  const sandboxes = [...source.matchAll(/sandbox="([^"]*)"/g)].map((m) => m[1]);

  it('sandboxes with allow-scripts and nothing else', () => {
    expect(sandboxes.length).toBeGreaterThan(0);
    for (const value of sandboxes) expect(value).toBe('allow-scripts');
  });

  it('never grants same-origin, which would undo the whole arrangement', () => {
    // With allow-same-origin the figure would run on OUR origin: it could read
    // IndexedDB, the Supabase session, and every other notebook the learner has.
    for (const value of sandboxes) expect(value).not.toContain('same-origin');
  });
});

describe('readVisualMessage', () => {
  it('reads an error report', () => {
    expect(
      readVisualMessage({ source: VISUAL_MESSAGE, kind: 'error', message: 'x is not defined' }),
    ).toEqual({ source: VISUAL_MESSAGE, kind: 'error', message: 'x is not defined' });
  });

  it('reads a height report', () => {
    expect(readVisualMessage({ source: VISUAL_MESSAGE, kind: 'height', height: 312.4 })).toEqual({
      source: VISUAL_MESSAGE,
      kind: 'height',
      height: 312,
    });
  });

  it('caps a runaway height', () => {
    // A figure with a broken layout must not be able to stretch the card until
    // it takes the canvas down with it.
    const msg = readVisualMessage({ source: VISUAL_MESSAGE, kind: 'height', height: 9e6 });
    expect(msg).toMatchObject({ height: 2000 });
  });

  it('truncates a runaway error message', () => {
    const msg = readVisualMessage({
      source: VISUAL_MESSAGE,
      kind: 'error',
      message: 'e'.repeat(5000),
    });
    expect((msg as { message: string }).message.length).toBeLessThanOrEqual(300);
  });

  it('ignores anything without our marker', () => {
    // The window gets messages from extensions, dev tools and other frames.
    expect(readVisualMessage({ kind: 'error', message: 'from somewhere else' })).toBeNull();
    expect(readVisualMessage({ source: 'other', kind: 'error', message: 'x' })).toBeNull();
    expect(readVisualMessage('height: 400')).toBeNull();
    expect(readVisualMessage(null)).toBeNull();
  });

  it('ignores a malformed report of the right shape', () => {
    expect(readVisualMessage({ source: VISUAL_MESSAGE, kind: 'error', message: 12 })).toBeNull();
    expect(
      readVisualMessage({ source: VISUAL_MESSAGE, kind: 'height', height: 'tall' }),
    ).toBeNull();
    expect(readVisualMessage({ source: VISUAL_MESSAGE, kind: 'height', height: 0 })).toBeNull();
    expect(readVisualMessage({ source: VISUAL_MESSAGE, kind: 'nonsense' })).toBeNull();
  });
});
