import { describe, expect, it } from 'vitest';
import { LessonStreamParser, composeChunkMd, mdSoFar } from './lessonStream';
import { findCheckRange } from './checkQuestion';

/** Feed a payload one character at a time — the worst case for a streaming parser. */
function streamCharByChar(payload: string): { emitted: string; parser: LessonStreamParser } {
  const parser = new LessonStreamParser();
  let emitted = '';
  for (const ch of payload) emitted += parser.push(ch);
  return { emitted, parser };
}

const CHUNK = {
  chunkTitle: '複利とは',
  md: '## 複利とは\n\n利子が"元本"に組み込まれます。\\ とバックスラッシュ。',
  checkQuestion: 'なぜ指数的に増えるの？',
  done: false,
};

describe('mdSoFar', () => {
  it('decodes escapes inside the md string', () => {
    const buf = '{"chunkTitle":"a","md":"line1\\nline2 \\"quoted\\" \\\\ end"';
    expect(mdSoFar(buf).text).toBe('line1\nline2 "quoted" \\ end');
  });

  it('reports incomplete until the closing quote arrives', () => {
    expect(mdSoFar('{"md":"half').complete).toBe(false);
    expect(mdSoFar('{"md":"whole"').complete).toBe(true);
  });

  it('holds back an escape split across deltas rather than emitting it wrong', () => {
    // A lone trailing backslash could still become \n; emitting it now would
    // put a stray backslash in the learner's lesson.
    expect(mdSoFar('{"md":"a\\').text).toBe('a');
    expect(mdSoFar('{"md":"a\\u30').text).toBe('a');
    expect(mdSoFar('{"md":"a\\u3042').text).toBe('aあ');
  });

  it('finds nothing before the md key appears', () => {
    expect(mdSoFar('{"chunkTitle":"まだ').text).toBe('');
  });
});

describe('LessonStreamParser', () => {
  it('streams the md field and nothing else, char by char', () => {
    const { emitted, parser } = streamCharByChar(JSON.stringify(CHUNK));
    expect(emitted).toBe(CHUNK.md);
    expect(parser.finish()).toEqual({
      chunkTitle: '複利とは',
      md: CHUNK.md,
      checkQuestion: 'なぜ指数的に増えるの？',
    });
  });

  it('never leaks JSON syntax into the node body', () => {
    const { emitted } = streamCharByChar(JSON.stringify(CHUNK));
    expect(emitted).not.toContain('chunkTitle');
    expect(emitted).not.toContain('{');
  });

  it('emits the same text however the deltas are chopped up', () => {
    const payload = JSON.stringify(CHUNK);
    for (const size of [1, 3, 7, 50]) {
      const parser = new LessonStreamParser();
      let out = '';
      for (let i = 0; i < payload.length; i += size) out += parser.push(payload.slice(i, i + size));
      expect(out, `chunk size ${size}`).toBe(CHUNK.md);
    }
  });

  it('carries the done flag through', () => {
    const { parser } = streamCharByChar(JSON.stringify({ ...CHUNK, done: true }));
    expect(parser.finish()?.done).toBe(true);
  });

  it('unwraps a ``` fence the model wrapped the object in', () => {
    const { emitted, parser } = streamCharByChar('```json\n' + JSON.stringify(CHUNK) + '\n```');
    expect(emitted).toBe(CHUNK.md);
    expect(parser.finish()?.chunkTitle).toBe('複利とは');
  });

  describe('a provider that ignores the JSON instruction', () => {
    const plain = '## 複利とは\n\n本文です。\n\n> ❓ なぜ？';

    it('streams plain markdown straight through', () => {
      const { emitted } = streamCharByChar(plain);
      expect(emitted).toBe(plain);
    });

    it('reports no structure, so the caller keeps what streamed', () => {
      const { parser } = streamCharByChar(plain);
      expect(parser.finish()).toBeNull();
      expect(parser.raw()).toBe(plain);
    });
  });

  it('keeps the markdown from a stream that was cut off mid-object', () => {
    // An aborted or truncated reply still wrote real lesson text; throwing it
    // away would lose the learner's chunk entirely.
    const { parser } = streamCharByChar('{"chunkTitle":"x","md":"半分だけ書か');
    expect(parser.finish()).toEqual({ chunkTitle: '', md: '半分だけ書か' });
  });

  it('reports nothing for an empty or junk reply', () => {
    expect(new LessonStreamParser().finish()).toBeNull();
    expect(streamCharByChar('{"chunkTitle":"x"}').parser.finish()).toBeNull();
  });
});

describe('composeChunkMd', () => {
  it('appends the check question in the exact form findCheckRange looks for', () => {
    // This is the whole point: the app formats the marker, so it cannot be
    // lost to a model that forgot it, used a different emoji, or dropped the
    // blockquote.
    const md = composeChunkMd({ chunkTitle: 't', md: '## t\n\n本文。', checkQuestion: 'なぜ？' });
    const range = findCheckRange(md)!;
    expect(range).not.toBeNull();
    expect(range.text).toBe('なぜ？');
    expect(md.slice(range.start, range.end)).toBe('なぜ？');
  });

  it('does not double up when the model already wrote one', () => {
    const md = composeChunkMd({
      chunkTitle: 't',
      md: '## t\n\n本文。\n\n> ❓ 既にある質問',
      checkQuestion: '別の質問',
    });
    expect(md.match(/❓/g)).toHaveLength(1);
    expect(findCheckRange(md)?.text).toBe('既にある質問');
  });

  it('leaves the body alone when there is no check question', () => {
    expect(composeChunkMd({ chunkTitle: 't', md: '## t\n\n本文。\n\n' })).toBe('## t\n\n本文。');
  });
});
