import type {
  AnswerRequest,
  GoalPlanRequest,
  LessonChunkRequest,
  LessonPlanRequest,
  SourceRequest,
  TeachService,
  TranslateRequest,
  ConceptMapRequest,
  VisualRequest,
} from './claude/types';
import {
  buildAnswerPrompt,
  buildGoalPlanPrompt,
  buildLessonChunkPrompt,
  buildLessonPlanPrompt,
  buildResponsePrompt,
  buildSourcesPrompt,
  buildVisualPrompt,
  buildTranslatePrompt,
  buildConceptMapPrompt,
  type ChatPrompt,
} from './prompts';
import { streamSseText } from './sse';
import { sawGeminiGrounding } from './grounding';
import { currentModel, useModelStore } from '../store/modelStore';
import { isModelUnavailable } from './modelHealth';

// Streams from the /api/chat proxy (Vite middleware in dev, Vercel edge
// function in production). The Gemini API key never reaches the browser.
export class GeminiService implements TeachService {
  private async *streamChat(
    prompt: ChatPrompt,
    signal?: AbortSignal,
    opts: {
      json?: boolean;
      noThinking?: boolean;
      search?: boolean;
      /** Called if grounding metadata shows up — i.e. a search really ran. */
      onGrounded?: () => void;
    } = {},
  ): AsyncGenerator<string> {
    const { onGrounded, ...wire } = opts;
    const watch = onGrounded
      ? (data: unknown) => {
          if (sawGeminiGrounding(data)) onGrounded();
        }
      : undefined;
    const send = (model: string) =>
      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...prompt, ...wire, model }),
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
          yield* streamSseText(res.body, undefined, watch);
          return;
        }
      }
      throw new Error(`chat proxy failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    if (!res.body) throw new Error('chat proxy returned no body');
    yield* streamSseText(res.body, undefined, watch);
  }

  async findSources(req: SourceRequest): Promise<{ raw: string; searched: boolean }> {
    let out = '';
    let searched = false;
    // Grounding with Google Search, and deliberately no JSON mode: the API
    // refuses the two together, so this reply comes back as prose-wrapped JSON
    // and parseSources reads it leniently. Worth the trade — the whole value of
    // a source is that it was not recalled.
    //
    // `searched` is set only if grounding actually shows up in the stream. A
    // model that decided it already knew, or one too old to hold the tool at
    // all, produces remembered links, and the learner is told so rather than
    // left to assume.
    //
    // Not used: groundingMetadata.groundingChunks. Its `web.uri` values are
    // vertexaisearch.cloud.google.com redirects, so harvesting them would give
    // every source Google's hostname — no domain to show, no YouTube id to
    // recognise, no video. The links come from the model's text, which grounding
    // made real; the metadata is read only as evidence that a search ran.
    //
    // Open item: Google's grounding terms ask that Search Suggestions
    // (groundingMetadata.searchEntryPoint) be displayed alongside grounded
    // results. Rendering it would mean forwarding that field through the proxy
    // and finding somewhere on the card for it.
    const stream = this.streamChat(buildSourcesPrompt(req), req.signal, {
      search: true,
      noThinking: true,
      onGrounded: () => {
        searched = true;
      },
    });
    for await (const delta of stream) out += delta;
    return { raw: out, searched };
  }

  async makeVisual(req: VisualRequest): Promise<string> {
    let out = '';
    // No JSON mode: the figure is a long program full of quotes, braces and
    // newlines, and asking for it inside a JSON string is where these replies
    // get truncated. parseVisual accepts raw HTML as readily as the envelope.
    const stream = this.streamChat(buildVisualPrompt(req), req.signal);
    for await (const delta of stream) out += delta;
    return out;
  }

  async planLesson(req: LessonPlanRequest): Promise<string> {
    let out = '';
    // No thinking, for the same reason as the other structured calls: it shares
    // the token budget with the answer, and a plan that comes back truncated is
    // a plan the learner cannot be shown.
    const stream = this.streamChat(buildLessonPlanPrompt(req), req.signal, {
      json: true,
      noThinking: true,
    });
    for await (const delta of stream) out += delta;
    return out;
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

  async suggestConcepts(req: ConceptMapRequest): Promise<string> {
    let out = '';
    // No thinking, for the same reason as the back-cast plan above: this asks
    // for one large structured document, and deliberation shares the token
    // budget with the answer — spend it thinking and the reply comes back
    // truncated or empty, which reads to the learner as "could not read the
    // suggestions" with nothing to act on.
    const stream = this.streamChat(buildConceptMapPrompt(req), req.signal, {
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
