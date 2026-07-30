import type {
  AnswerRequest,
  GoalPlanRequest,
  LessonChunkRequest,
  TeachService,
  TranslateRequest,
} from './claude/types';
import {
  buildAnswerPrompt,
  buildGoalPlanPrompt,
  buildLessonChunkPrompt,
  buildResponsePrompt,
  buildTranslatePrompt,
  type ChatPrompt,
} from './prompts';
import { streamSseText } from './sse';
import { currentModel, useModelStore } from '../store/modelStore';
import { isModelUnavailable } from './modelHealth';

// Streams from the /api/chat proxy (Vite middleware in dev, Vercel edge
// function in production). The Gemini API key never reaches the browser.
export class GeminiService implements TeachService {
  private async *streamChat(
    prompt: ChatPrompt,
    signal?: AbortSignal,
    opts: { json?: boolean; noThinking?: boolean } = {},
  ): AsyncGenerator<string> {
    const send = (model: string) =>
      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...prompt, ...opts, model }),
        signal,
      });

    const model = currentModel();
    let res = await send(model);

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      // Google lists models it then refuses to run. Retire this one so it is
      // never offered again, and retry on one that works rather than making
      // the learner lose the question to a choice the app suggested.
      if (isModelUnavailable(res.status, detail)) {
        const replacement = useModelStore.getState().markUnusable(model);
        if (replacement !== null && replacement !== model) {
          res = await send(replacement);
          if (!res.ok || !res.body) {
            const retryDetail = await res.text().catch(() => '');
            throw new Error(`chat proxy failed (${res.status}): ${retryDetail.slice(0, 200)}`);
          }
          yield* streamSseText(res.body);
          return;
        }
      }
      throw new Error(`chat proxy failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    if (!res.body) throw new Error('chat proxy returned no body');
    yield* streamSseText(res.body);
  }

  streamAnswer(req: AnswerRequest): AsyncGenerator<string> {
    const prompt = req.intent === 'respond' ? buildResponsePrompt(req) : buildAnswerPrompt(req);
    return this.streamChat(prompt, req.signal);
  }

  streamLessonChunk(req: LessonChunkRequest): AsyncGenerator<string> {
    // JSON, but still streamed: LessonStreamParser renders the md field live as
    // it arrives, so structured output costs no interactivity.
    return this.streamChat(buildLessonChunkPrompt(req), req.signal, { json: true });
  }

  async decomposeGoal(req: GoalPlanRequest): Promise<string> {
    let out = '';
    // Structured output, and no thinking: we want a parseable object, not
    // deliberation that eats the token budget and returns empty text.
    const stream = this.streamChat(buildGoalPlanPrompt(req), req.signal, {
      json: true,
      noThinking: true,
    });
    for await (const delta of stream) out += delta;
    return out;
  }

  async translate(req: TranslateRequest): Promise<string> {
    let out = '';
    // No thinking: translation is a transformation, and every batch of the
    // notebook is in flight at once — deliberation here is pure latency.
    const stream = this.streamChat(buildTranslatePrompt(req), req.signal, {
      json: true,
      noThinking: true,
    });
    for await (const delta of stream) out += delta;
    return out;
  }
}
