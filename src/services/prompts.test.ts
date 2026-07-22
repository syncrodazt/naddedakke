import { describe, expect, it } from 'vitest';
import { buildAnswerPrompt, buildLessonChunkPrompt } from './prompts';
import { LESSON_DONE_MARKER } from './claude/types';

describe('prompt builders', () => {
  it('answer prompt carries the quote, question, and ancestor context', () => {
    const p = buildAnswerPrompt({
      sessionId: 's',
      question: 'why is this the case?',
      quotedText: '指数関数の性質',
      contextMd: '## 72の法則\n\n本文…',
    });
    expect(p.user).toContain('> 指数関数の性質');
    expect(p.user).toContain('why is this the case?');
    expect(p.user).toContain('72の法則');
    expect(p.system).toContain('なんで？');
  });

  it('lesson prompt carries the topic, prior chunks, and the done marker protocol', () => {
    const p = buildLessonChunkPrompt({
      sessionId: 's',
      topic: 'ベイズの定理',
      previousChunksMd: ['## その1\n中身1', '## その2\n中身2'],
      chunkIndex: 2,
    });
    expect(p.user).toContain('ベイズの定理');
    expect(p.user).toContain('中身2');
    expect(p.user).toContain('チャンク3');
    expect(p.system).toContain(LESSON_DONE_MARKER);
    expect(p.system).toContain('1チャンクだけ');
  });
});
