import { describe, expect, it } from 'vitest';
import { VisualError, parseVisual, usesThree } from './parse';

const CODE = '<canvas id="c"></canvas><script>var x = 1; draw(x);</script>';

describe('parseVisual', () => {
  it('reads the JSON envelope it asked for', () => {
    const v = parseVisual(JSON.stringify({ title: 'Interference', html: CODE }), 'fallback');
    expect(v).toEqual({ title: 'Interference', html: CODE, three: false });
  });

  it('unwraps a fenced envelope', () => {
    const raw = '```json\n' + JSON.stringify({ title: 'T', html: CODE }) + '\n```';
    expect(parseVisual(raw, 'fallback').html).toBe(CODE);
  });

  it('accepts plain HTML when the model drops the envelope', () => {
    // Long code is exactly where models forget the wrapper, and there is
    // nothing to lose: the HTML goes into the sandbox either way, so the
    // envelope was never a safety measure.
    expect(parseVisual(CODE, 'fallback')).toMatchObject({ html: CODE, title: 'fallback' });
  });

  it('drops the sentence a model writes before the code', () => {
    const v = parseVisual(`Here is a figure that shows it:\n\n${CODE}`, 'fallback');
    expect(v.html.startsWith('<canvas')).toBe(true);
  });

  it('falls back to the given title when none came back', () => {
    expect(parseVisual(JSON.stringify({ html: CODE }), 'Compound interest').title).toBe(
      'Compound interest',
    );
  });

  it('detects three.js from the code, not from a flag', () => {
    // Believing a flag costs either a blank box (three missing when needed) or
    // 700KB shipped for a bar chart. The code cannot be wrong about what it
    // references.
    const threeCode = '<div id="w"></div><script>var s = new THREE.Scene();</script>';
    expect(parseVisual(JSON.stringify({ html: threeCode }), 't').three).toBe(true);
    expect(parseVisual(JSON.stringify({ html: CODE, three: true }), 't').three).toBe(false);
  });

  it('refuses a reply with no figure in it', () => {
    expect(() => parseVisual('', 't')).toThrow(/empty reply/);
    expect(() => parseVisual('I cannot make that.', 't')).toThrow(VisualError);
    expect(() => parseVisual(JSON.stringify({ title: 'T', html: '<p>hi</p>' }), 't')).toThrow(
      VisualError,
    );
  });
});

describe('usesThree', () => {
  it('is true only for a real reference to the global', () => {
    expect(usesThree('new THREE.WebGLRenderer()')).toBe(true);
    expect(usesThree('THREE .Scene')).toBe(true);
    // A mention in prose is not a use, and would cost 700KB to believe.
    expect(usesThree('<p>drawn with three.js ideas</p>')).toBe(false);
    expect(usesThree('var THREED = 1;')).toBe(false);
    expect(usesThree('ctx.fillRect(0,0,1,1)')).toBe(false);
  });
});
