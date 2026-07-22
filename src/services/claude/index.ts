import type { TeachService } from './types';
import { MockClaudeService } from './mock';
import { GeminiService } from '../gemini';

// Real provider behind the /api/chat proxy. When the proxy is unreachable or
// no API key is configured, callers fall back to the mock (see withFallback
// in ../stream.ts) so the app stays usable offline.
export const teachService: TeachService = new GeminiService();
export const mockService: TeachService = new MockClaudeService();
