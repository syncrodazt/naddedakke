import { describe, expect, it } from 'vitest';
import { headingOf } from './heading';

describe('headingOf', () => {
  it('takes the markdown heading', () => {
    expect(headingOf('## Sampling\n\nBody text.')).toBe('Sampling');
    expect(headingOf('# Top\n\n## Second')).toBe('Top');
  });

  it('falls back to the first real line', () => {
    expect(headingOf('Just a paragraph.\n\nMore.')).toBe('Just a paragraph.');
  });

  it('skips the quoted passage a question node opens with', () => {
    // A question node starts "> <the highlighted text>", which is the parent's
    // words, not this node's subject.
    expect(headingOf('> quoted bit\n\nWhy is this?')).toBe('Why is this?');
  });

  it('strips inline markdown rather than sending raw syntax', () => {
    expect(headingOf('**bold** and `code`')).toBe('bold and code');
  });

  it('is empty for an empty body', () => {
    expect(headingOf('')).toBe('');
    expect(headingOf('\n\n')).toBe('');
  });
});
