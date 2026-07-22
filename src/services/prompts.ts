import type { AnswerRequest, LessonChunkRequest } from './claude/types';
import { LESSON_DONE_MARKER } from './claude/types';

// Prompt construction is provider-agnostic: every service receives a plain
// {system, user} pair and maps it onto its own wire format.
//
// Language: the tutor mirrors the learner — a Thai topic gets a Thai lesson,
// an English question gets an English answer, and so on. Section labels in
// the user prompt are kept in English so they don't bias the detection.

export type ChatPrompt = { system: string; user: string };

const TUTOR_PERSONA =
  'You are a tutor who teaches from first principles. ' +
  'Always respond in the same language the learner uses — detect it from their topic or ' +
  'question (e.g. Thai, English, Japanese) and write the entire response in that language. ' +
  'Write concise, accurate Markdown. Math may use KaTeX notation ($...$ / $$...$$). ' +
  'Never write raw HTML.';

export function buildAnswerPrompt(req: AnswerRequest): ChatPrompt {
  return {
    system:
      `${TUTOR_PERSONA}\n` +
      'The learner highlighted a passage in the lesson and asked "why?" about it. ' +
      'Explain the highlighted passage itself from first principles — conclusion first, ' +
      'derivation after. Keep it around 150-250 words.',
    user:
      `## Lesson context (ancestor chain)\n\n${req.contextMd || '(none)'}\n\n` +
      `## Highlighted passage\n\n> ${req.quotedText}\n\n` +
      `## Question\n\n${req.question}`,
  };
}

export function buildResponsePrompt(req: AnswerRequest): ChatPrompt {
  return {
    system:
      `${TUTOR_PERSONA}\n` +
      'The learner highlighted a prompt/question in the lesson and wrote their own ' +
      'answer to it. Give warm, specific feedback: say what is correct, gently correct ' +
      'what is wrong or incomplete, fill the key gap, and end with one sentence that ' +
      'moves their understanding forward. Keep it around 120-200 words.',
    user:
      `## Lesson context (ancestor chain)\n\n${req.contextMd || '(none)'}\n\n` +
      `## The prompt they answered\n\n> ${req.quotedText}\n\n` +
      `## Their answer\n\n${req.question}`,
  };
}

export function buildLessonChunkPrompt(req: LessonChunkRequest): ChatPrompt {
  const previous =
    req.previousChunksMd.length > 0
      ? req.previousChunksMd.map((md, i) => `### Chunk ${i + 1}\n${md}`).join('\n\n')
      : '(none yet)';
  return {
    system:
      `${TUTOR_PERSONA}\n` +
      'You teach the topic Socratically, split into roughly 10 small chunks. ' +
      'Write ONLY the next single chunk — never the whole lesson at once.\n' +
      'Format: the first line is "## <title>", then a 150-250 word Markdown body ' +
      "(title and body in the learner's language).\n" +
      `If this is the final chunk of the lesson, add one extra line after the body ` +
      `containing exactly "${LESSON_DONE_MARKER}".`,
    user:
      `## Topic\n\n${req.topic}\n\n` +
      `## Chunks so far\n\n${previous}\n\n` +
      `Write chunk ${req.chunkIndex + 1}.`,
  };
}
