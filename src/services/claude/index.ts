import type { AnswerRequest, GoalPlanRequest, LessonChunkRequest, TeachService } from './types';
import { MockClaudeService } from './mock';
import { GeminiService } from '../gemini';
import { ClaudeService } from '../anthropic';
import { currentModel } from '../../store/modelStore';

/**
 * Routes every call to the provider that owns the currently selected model.
 * The graph, the store and the UI only ever see `teachService`, so adding a
 * provider is this file plus one class — nothing upstream changes.
 *
 * Routing is by model id because that is what the learner actually picks:
 * `claude-*` ids go to the Anthropic proxy, everything else (gemini-*, gemma-*)
 * to the Gemini one. When the proxy is unreachable or no API key is configured,
 * callers fall back to the mock (see withFallback in ../stream.ts) so the app
 * stays usable offline.
 */
class RoutingService implements TeachService {
  private readonly claude = new ClaudeService();
  private readonly gemini = new GeminiService();

  private pick(): TeachService {
    return currentModel().startsWith('claude-') ? this.claude : this.gemini;
  }

  streamAnswer(req: AnswerRequest): AsyncGenerator<string> {
    return this.pick().streamAnswer(req);
  }

  streamLessonChunk(req: LessonChunkRequest): AsyncGenerator<string> {
    return this.pick().streamLessonChunk(req);
  }

  decomposeGoal(req: GoalPlanRequest): Promise<string> {
    return this.pick().decomposeGoal(req);
  }
}

export const teachService: TeachService = new RoutingService();
export const mockService: TeachService = new MockClaudeService();
