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
    expect(p.system).toContain('first principles');
  });

  it('lesson prompt carries the topic, prior chunks, and the done marker protocol', () => {
    const p = buildLessonChunkPrompt({
      sessionId: 's',
      topic: 'ทฤษฎีบทของเบย์',
      previousChunksMd: ['## Chunk A\nbody A', '## Chunk B\nbody B'],
      chunkIndex: 2,
    });
    expect(p.user).toContain('ทฤษฎีบทของเบย์');
    expect(p.user).toContain('body B');
    expect(p.user).toContain('Write chunk 3');
    expect(p.system).toContain(LESSON_DONE_MARKER);
    expect(p.system).toContain('next single chunk');
  });

  it('instructs the model to mirror the learner language', () => {
    const p = buildLessonChunkPrompt({
      sessionId: 's',
      topic: 'compound interest',
      previousChunksMd: [],
      chunkIndex: 0,
    });
    expect(p.system).toContain('same language');
  });
});
