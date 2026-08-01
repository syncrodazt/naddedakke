import type {
  AnswerRequest,
  GoalPlanRequest,
  LessonChunkRequest,
  TranslateRequest,
  ConceptMapRequest,
} from './claude/types';

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
      'stay ASCII identifiers.' +
      (req.existingNames?.length
        ? "\n- These quantities ALREADY EXIST on the learner's canvas: " +
          `${req.existingNames.join(', ')}. Formulas may reference them, but do NOT ` +
          'redefine them in "variables" or "derived".'
        : ''),
    user: `Goal:\n\n${req.goal}`,
  };
}

const CHUNK_JSON_RULES =
  'Reply with ONE JSON object and nothing else — no prose, no code fence:\n' +
  '{"chunkTitle":string,"md":string,"checkQuestion":string,"done":boolean}\n' +
  '- "md": the chunk body in Markdown, 150-250 words, first line "## <title>". ' +
  'Do NOT put the comprehension question in here.\n' +
  '- "checkQuestion": one short question that checks whether the learner ' +
  'understood THIS chunk. Plain text, no "> " or emoji — the app formats it.\n' +
  '- "chunkTitle", "md" and "checkQuestion" are in the learner\'s language.';

/**
 * "What do I need to understand before this?" — the backwards move in a lesson,
 * the mirror of asking why forwards.
 *
 * ONE step back per request, not a syllabus: the learner can ask again on the
 * answer to keep going, which is the same recursion なんで？ uses and is how the
 * canvas reaches first principles a step at a time.
 */
export function buildPrerequisitePrompt(req: LessonChunkRequest): ChatPrompt {
  return {
    system:
      `${TUTOR_PERSONA}\n` +
      'The learner is stuck on a passage and wants what comes BEFORE it. Write ' +
      'the single most important concept they must understand FIRST in order to ' +
      'follow it — one step back, not a whole syllabus, and not a restatement ' +
      'of the passage itself. Assume nothing about the passage is understood.\n' +
      `${CHUNK_JSON_RULES}\n- "done": always false.`,
    user:
      `## Topic\n\n${req.topic}\n\n` +
      `## The passage they are stuck on\n\n${req.prerequisiteFor ?? ''}\n\n` +
      'What must they understand before this?',
  };
}

export function buildLessonChunkPrompt(req: LessonChunkRequest): ChatPrompt {
  if (req.prerequisiteFor !== undefined) return buildPrerequisitePrompt(req);
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

/**
 * Translate whole nodes at once — body plus the quotes anchored inside it.
 *
 * The quotes are the reason this is one call rather than two: a highlight is
 * found again in the translated body by searching for its translated quote, so
 * the quote has to be translated the same way, in the same pass, by something
 * that can see the sentence it came from. Asking separately would produce a
 * phrasing that never appears in the body and orphan the branch.
 */
export function buildTranslatePrompt(req: TranslateRequest): ChatPrompt {
  return {
    system:
      'You translate Markdown study notes. Reply with ONE JSON object and nothing ' +
      'else — no prose, no code fence:\n' +
      '{"items":[{"id":string,"sourceLang":string,"md":string,' +
      '"quotes":[{"id":string,"text":string}]}]}\n' +
      `Translate every "md" into ${req.targetLabel}.\n` +
      'Rules:\n' +
      '- Return one entry per input item, with the SAME "id". Never merge, drop ' +
      'or reorder items.\n' +
      '- "sourceLang" is the BCP-47 base code of the language the input was ' +
      'written in (e.g. "ja", "th", "en").\n' +
      '- Preserve the Markdown structure exactly: same headings, list shape, ' +
      'blockquotes, bold/italic, line breaks. If a line starts with "> ❓ ", keep ' +
      'that prefix character-for-character and translate only what follows it.\n' +
      '- Do NOT translate: math between $...$ or $$...$$, anything inside ' +
      'backticks, code blocks, URLs, and identifiers/formulas (snake_case names ' +
      'like `monthly_saving` and expressions that reference them). Copy them ' +
      'through unchanged.\n' +
      '- Translate meaning, not words: this is a tutor explaining an idea, so it ' +
      'must read naturally to a native speaker.\n' +
      '- "quotes" are passages the learner highlighted inside that item. Translate ' +
      'each one so that it appears VERBATIM as a substring of your translated ' +
      '"md" — same characters, same spacing. This is a hard requirement: a quote ' +
      'that does not occur in "md" breaks the link to the follow-up question. ' +
      'Return every quote you were given, with the same "id". A quote may be ' +
      'written in a different language than "md"; find the passage it refers to ' +
      'and give that passage in ' +
      `${req.targetLabel}.`,
    user: JSON.stringify({ items: req.items }),
  };
}

/**
 * "What should I learn next?"
 *
 * The map is GENERATED, not mined out of the notebooks. Mining could only ever
 * describe what the learner has already met, which is the opposite of the
 * question — and it could never notice that a component tree in a UI framework
 * and an assembly tree in CAD are the same idea, because that takes knowledge
 * of the world rather than knowledge of the graph.
 *
 * Every concept must say what it connects to. A recommendation with no stated
 * reason is one the learner can only obey, which is the wrong relationship to
 * have with a curriculum a machine wrote.
 */
export function buildConceptMapPrompt(req: ConceptMapRequest): ChatPrompt {
  return {
    system:
      'You map out what someone should learn next, as a prerequisite graph.\n' +
      'Reply with ONE JSON object and nothing else — no prose, no code fence:\n' +
      '{"concepts":[{"id":string,"name":string,"blurb":string,' +
      '"prereqs":[string],"sessionIds":[string],"why":string}]}\n' +
      'Rules:\n' +
      '- "id" is a lowercase kebab-case slug, unique, stable and descriptive ' +
      '(e.g. "nyquist-limit"). Use it, not the name, inside "prereqs".\n' +
      '- "prereqs" lists the concepts someone must understand BEFORE this one, ' +
      'by id, referencing only ids in this same reply. The graph must be ' +
      'acyclic: never make two concepts require each other.\n' +
      '- "sessionIds" lists the notebooks below that already cover this ' +
      'concept, using their exact ids. Use [] when none do. NEVER invent an id.\n' +
      '- Include BOTH: concepts the notebooks already cover (so the graph is ' +
      'anchored in what they have), and new ones they have not met.\n' +
      `- Propose about ${req.want} concepts they have NOT met yet, chosen so ` +
      'that each genuinely builds on something in their notebooks.\n' +
      '- Prefer transferable ideas over trivia: a concept that recurs across ' +
      'domains is worth more than one fact. If the same underlying idea appears ' +
      'in several of their notebooks under different names, say so in "why".\n' +
      '- "why" is one sentence naming what in THEIR notebooks this connects to, ' +
      'and what understanding it would open up.\n' +
      `- "name", "blurb" and "why" are written in ${req.langLabel}. Ids stay ` +
      'ASCII slugs.',
    user:
      "## The learner's notebooks\n\n" +
      (req.inventory.length === 0
        ? '(none yet — propose a starting graph for a curious beginner)'
        : req.inventory
            .map((n) => `- id: ${n.id}\n  title: ${n.title}\n  covers: ${n.headings.join('; ')}`)
            .join('\n')),
  };
}
