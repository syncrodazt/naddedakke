import type {
  AnswerRequest,
  GoalPlanRequest,
  LessonChunkRequest,
  TeachService,
  TranslateRequest,
  ConceptMapRequest,
} from './claude/types';
import {
  buildAnswerPrompt,
  buildGoalPlanPrompt,
  buildLessonChunkPrompt,
  buildResponsePrompt,
  buildTranslatePrompt,
  buildConceptMapPrompt,
  type ChatPrompt,
} from './prompts';
import { extractClaudeText, streamSseText } from './sse';
import { currentModel } from '../store/modelStore';
import { GOAL_PLAN_SCHEMA } from '../gyakusan/planSchema';
import { LESSON_CHUNK_SCHEMA } from './lessonSchema';
import { TRANSLATE_SCHEMA } from './translateSchema';
import { CONCEPT_MAP_SCHEMA } from '../concepts/schema';

// Streams from the /api/claude proxy (Vite middleware in dev, Vercel edge
// function in production). The Anthropic API key never reaches the browser.
//
// Named anthropic.ts rather than claude.ts because src/services/claude/ is the
// provider-agnostic seam (types + mock), not this provider.

type ChatOptions = {
  /** JSON Schema for a structured reply. */
  schema?: Record<string, unknown>;
  /**
   * Reasoning effort. Thinking is on by default on these models and counts
   * against max_tokens, so effort — not a thinking budget — is the lever:
   * `budget_tokens` is rejected with a 400.
   */
  effort?: 'low' | 'medium' | 'high';
};

export class ClaudeService implements TeachService {
  private async *streamChat(
    prompt: ChatPrompt,
    signal?: AbortSignal,
    opts: ChatOptions = {},
  ): AsyncGenerator<string> {
    const res = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...prompt, ...opts, model: currentModel() }),
      signal,
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      throw new Error(`claude proxy failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    yield* streamSseText(res.body, extractClaudeText);
  }

  streamAnswer(req: AnswerRequest): AsyncGenerator<string> {
    const prompt = req.intent === 'respond' ? buildResponsePrompt(req) : buildAnswerPrompt(req);
    // Medium effort: these are short explanatory passages streaming into a node
    // the learner is watching, so deliberation costs visible latency.
    return this.streamChat(prompt, req.signal, { effort: 'medium' });
  }

  streamLessonChunk(req: LessonChunkRequest): AsyncGenerator<string> {
    // Structured, but still streamed: LessonStreamParser renders the md field
    // live as it arrives, so the schema costs no interactivity.
    return this.streamChat(buildLessonChunkPrompt(req), req.signal, {
      schema: LESSON_CHUNK_SCHEMA,
      effort: 'medium',
    });
  }

  async decomposeGoal(req: GoalPlanRequest): Promise<string> {
    let out = '';
    // High effort and a schema: a back-cast plan is arithmetic the learner will
    // trust, and it must parse. Nothing is shown until it does.
    const stream = this.streamChat(buildGoalPlanPrompt(req), req.signal, {
      schema: GOAL_PLAN_SCHEMA,
      effort: 'high',
    });
    for await (const delta of stream) out += delta;
    return out;
  }

  async translate(req: TranslateRequest): Promise<string> {
    let out = '';
    // Low effort: translation is a transformation, not a problem to think
    // about, and every batch of the notebook is in flight at once — this is the
    // one call where latency is the whole experience.
    const stream = this.streamChat(buildTranslatePrompt(req), req.signal, {
      schema: TRANSLATE_SCHEMA,
      effort: 'low',
    });
    for await (const delta of stream) out += delta;
    return out;
  }

  async suggestConcepts(req: ConceptMapRequest): Promise<string> {
    let out = '';
    // High effort: this is the one call that decides what the learner spends
    // the next weeks on, and it has to hold a whole dependency graph straight
    // in its head. Nothing is shown until it parses.
    const stream = this.streamChat(buildConceptMapPrompt(req), req.signal, {
      schema: CONCEPT_MAP_SCHEMA,
      effort: 'high',
    });
    for await (const delta of stream) out += delta;
    return out;
  }
}
