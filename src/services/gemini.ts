import type { AnswerRequest, LessonChunkRequest, TeachService } from './claude/types';
import {
  buildAnswerPrompt,
  buildLessonChunkPrompt,
  buildResponsePrompt,
  type ChatPrompt,
} from './prompts';
import { streamSseText } from './sse';
import { currentModel } from '../store/modelStore';

// Streams from the /api/chat proxy (Vite middleware in dev, Vercel edge
// function in production). The Gemini API key never reaches the browser.
export class GeminiService implements TeachService {
  private async *streamChat(prompt: ChatPrompt, signal?: AbortSignal): AsyncGenerator<string> {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...prompt, model: currentModel() }),
      signal,
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      throw new Error(`chat proxy failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    yield* streamSseText(res.body);
  }

  streamAnswer(req: AnswerRequest): AsyncGenerator<string> {
    const prompt = req.intent === 'respond' ? buildResponsePrompt(req) : buildAnswerPrompt(req);
    return this.streamChat(prompt, req.signal);
  }

  streamLessonChunk(req: LessonChunkRequest): AsyncGenerator<string> {
    return this.streamChat(buildLessonChunkPrompt(req), req.signal);
  }
}
