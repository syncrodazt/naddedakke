import { describe, expect, it } from 'vitest';
import {
  buildAnswerPrompt,
  buildLessonChunkPrompt,
  buildLessonPlanPrompt,
  buildResponsePrompt,
} from './prompts';

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
    expect(p.system).toContain('"done":boolean');
    expect(p.system).toContain('next single chunk');
  });

  it('response prompt frames the learner answer for feedback', () => {
    const p = buildResponsePrompt({
      sessionId: 's',
      question: 'because the brain ignores quiet sounds near loud ones',
      quotedText: 'can you think of situations where a sound is masked?',
      contextMd: '## MP3\n\nbody',
      intent: 'respond',
    });
    expect(p.user).toContain('can you think of situations');
    expect(p.user).toContain('because the brain ignores');
    expect(p.system).toContain('feedback');
  });

  it('writes the step the learner was shown, not whatever comes next', () => {
    // The plan was shown before a word of the lesson existed, so it is a
    // promise. A chunk prompt that ignored it would quietly break that.
    const steps = [
      { title: 'What a wave is', gist: 'ground for the rest' },
      { title: 'Superposition', gist: 'two waves in one place' },
      { title: 'Interference', gist: 'what that looks like' },
    ];
    const p = buildLessonChunkPrompt({
      sessionId: 's',
      topic: 'waves',
      previousChunksMd: ['## What a wave is'],
      chunkIndex: 1,
      plan: { steps, stepIndex: 1 },
    });
    expect(p.user).toContain('Write step 2: Superposition');
    expect(p.user).toContain('two waves in one place');
    // The rest of the plan goes in too: a step written blind to what follows
    // repeats the later ones or steals their punchline.
    expect(p.user).toContain('3. Interference');
    expect(p.system).toContain('not the whole lesson');
  });

  it('plans without teaching', () => {
    const p = buildLessonPlanPrompt({ topic: 'waves', langLabel: 'ไทย' });
    expect(p.system).toContain('"steps"');
    expect(p.system).toContain('Do NOT teach here');
    expect(p.system).toContain('ไทย');
    expect(p.user).toContain('waves');
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
