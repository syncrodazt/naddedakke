import type { AnswerRequest, GoalPlanRequest, LessonChunkRequest } from './claude/types';

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

export function buildGoalPlanPrompt(req: GoalPlanRequest): ChatPrompt {
  return {
    system:
      'You decompose a goal backwards into the quantities it depends on, as a ' +
      'spreadsheet-style dependency graph.\n' +
      'Reply with ONE JSON object and nothing else — no prose, no code fence.\n' +
      'Shape:\n' +
      '{"title":string,"goalLabel":string,"goalNote":string,' +
      '"variables":[{"name":string,"label":string,"value":number,"unit":string,' +
      '"min":number,"max":number,"step":number}],' +
      '"derived":[{"name":string,"label":string,"formula":string,"unit":string,"note":string}],' +
      '"goalOf":string}\n' +
      'Rules:\n' +
      '- "name" is a snake_case identifier (letters, digits, underscore). All names unique.\n' +
      '- "variables" are the inputs the learner can move; give each a realistic ' +
      'starting value and a sensible slider min/max/step that contains it.\n' +
      '- "derived" are computed quantities. "formula" is a mathjs expression that may ' +
      'reference ONLY the names defined in this object. No cycles. Functions like ' +
      'max(), min(), sqrt(), ^ are allowed.\n' +
      '- "goalOf" is the name of the derived quantity that answers the goal.\n' +
      '- Aim for 4-7 variables and 2-5 derived quantities: enough to be honest, ' +
      'few enough to reason about.\n' +
      '- "label", "goalLabel", "goalNote" and "note" are shown to the learner, so write ' +
      "them in the learner's own language (detect it from the goal). Names and formulas " +
      'stay ASCII identifiers.',
    user: `Goal:\n\n${req.goal}`,
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
      'Reply with ONE JSON object and nothing else — no prose, no code fence:\n' +
      '{"chunkTitle":string,"md":string,"checkQuestion":string,"done":boolean}\n' +
      '- "md": the chunk body in Markdown, 150-250 words, first line "## <title>". ' +
      'Do NOT put the comprehension question in here.\n' +
      '- "checkQuestion": one short question that checks whether the learner ' +
      'understood THIS chunk. Plain text, no "> " or emoji — the app formats it.\n' +
      '- "done": true only if this is the final chunk of the lesson.\n' +
      '- "chunkTitle", "md" and "checkQuestion" are in the learner\'s language.',
    user:
      `## Topic\n\n${req.topic}\n\n` +
      `## Chunks so far\n\n${previous}\n\n` +
      `Write chunk ${req.chunkIndex + 1}.`,
  };
}
