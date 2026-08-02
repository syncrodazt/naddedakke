import { describe, expect, it } from 'vitest';
import { sawClaudeSearch, sawGeminiGrounding } from './grounding';

describe('sawGeminiGrounding', () => {
  it('sees a search that returned sources', () => {
    expect(
      sawGeminiGrounding({
        candidates: [
          {
            content: { parts: [{ text: 'hi' }] },
            groundingMetadata: {
              groundingChunks: [{ web: { uri: 'https://x.test', title: 'X' } }],
            },
          },
        ],
      }),
    ).toBe(true);
  });

  it('sees a search that ran even if it matched nothing', () => {
    // The query is the evidence that a search happened; zero results is a
    // result, not an absence of searching.
    expect(
      sawGeminiGrounding({
        candidates: [{ groundingMetadata: { webSearchQueries: ['mp3 psychoacoustics'] } }],
      }),
    ).toBe(true);
  });

  it('is false for an ordinary text chunk', () => {
    expect(sawGeminiGrounding({ candidates: [{ content: { parts: [{ text: 'hello' }] } }] })).toBe(
      false,
    );
  });

  it('is false for an empty grounding object', () => {
    // The field being present is not proof. Treating it as proof is exactly the
    // optimistic error that would put a citation badge on remembered links.
    expect(sawGeminiGrounding({ candidates: [{ groundingMetadata: {} }] })).toBe(false);
    expect(
      sawGeminiGrounding({
        candidates: [{ groundingMetadata: { groundingChunks: [], webSearchQueries: [] } }],
      }),
    ).toBe(false);
  });

  it('is false for anything malformed', () => {
    expect(sawGeminiGrounding(null)).toBe(false);
    expect(sawGeminiGrounding('text')).toBe(false);
    expect(sawGeminiGrounding({})).toBe(false);
    expect(sawGeminiGrounding({ candidates: 'nope' })).toBe(false);
    expect(sawGeminiGrounding({ candidates: [{ groundingMetadata: 'yes' }] })).toBe(false);
  });
});

describe('sawClaudeSearch', () => {
  it('sees the proxy flag', () => {
    expect(sawClaudeSearch({ searched: true })).toBe(true);
  });

  it('is false for a text delta, and for anything else', () => {
    expect(sawClaudeSearch({ text: 'hello' })).toBe(false);
    expect(sawClaudeSearch({ searched: false })).toBe(false);
    // Not truthiness: only the flag itself counts.
    expect(sawClaudeSearch({ searched: 'yes' })).toBe(false);
    expect(sawClaudeSearch(null)).toBe(false);
  });
});
