import { describe, expect, it } from 'vitest';
import { extractQuestionText } from './reprompt';

describe('extractQuestionText', () => {
  it('takes the text after the quoted blockquote', () => {
    expect(extractQuestionText('> the sky scatters\n\nwhy is this the case?')).toBe(
      'why is this the case?',
    );
  });

  it('handles a multi-line quote', () => {
    expect(extractQuestionText('> line one\n> line two\n\nmy question')).toBe('my question');
  });

  it('handles a free-form idea (empty quote line)', () => {
    expect(extractQuestionText('> \n\nwhat if we sampled 10x faster?')).toBe(
      'what if we sampled 10x faster?',
    );
  });

  it('falls back to stripping the blockquote when there is no separator', () => {
    expect(extractQuestionText('> just a quote')).toBe('just a quote');
  });
});
