import type { TeachService } from './types';
import { MockClaudeService } from './mock';

// Milestone 4 swaps exactly this line for the real streaming API client.
export const teachService: TeachService = new MockClaudeService();
