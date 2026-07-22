import { describe, expect, it } from 'vitest';
import { findCheckRange } from './checkQuestion';

describe('findCheckRange', () => {
  it('locates the ❓ comprehension question and its exact source range', () => {
    const md =
      '## Title\n\nSome body text explaining a thing.\n\n> ❓ Why does the sky scatter blue light?';
    const r = findCheckRange(md)!;
    expect(r).not.toBeNull();
    expect(r.text).toBe('Why does the sky scatter blue light?');
    expect(md.slice(r.start, r.end)).toBe(r.text);
  });

  it('works in any language', () => {
    const md = 'เนื้อหา...\n\n> ❓ ทำไมดอกเบี้ยทบต้นถึงโตแบบทวีคูณ?';
    const r = findCheckRange(md)!;
    expect(r.text).toBe('ทำไมดอกเบี้ยทบต้นถึงโตแบบทวีคูณ?');
    expect(md.slice(r.start, r.end)).toBe(r.text);
  });

  it('returns null when there is no check question', () => {
    expect(findCheckRange('## Title\n\nJust a body, no question.')).toBeNull();
    expect(findCheckRange('> a normal quote, not a check')).toBeNull();
  });
});
