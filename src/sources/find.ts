import { newId } from '../model/ids';
import { useGraphStore } from '../store/graphStore';
import { currentDisplay } from '../store/displayContent';
import { isAbort, useLlmStore } from '../store/llmStore';
import { teachService } from '../services/claude';
import { langLabel } from '../i18n/langLabel';
import { parseSources } from './parse';
import { useSourceStore } from './sourceStore';

/**
 * Find sources for one node and attach them.
 *
 * Never falls back to the mock, unlike every other call in the app. A canned
 * lesson chunk is a visibly offline stand-in; a canned citation would be a
 * fabricated one, and pointing the learner at a link that was invented to fill
 * a gap is worse than telling them the search did not happen.
 */
export async function findSourcesFor(nodeId: string): Promise<void> {
  const { session, nodes } = useGraphStore.getState();
  const node = nodes[nodeId];
  if (!session || !node) return;

  const llm = useLlmStore.getState();
  useSourceStore.getState().begin(nodeId);
  try {
    const { raw, searched } = await teachService.findSources({
      topic: session.title,
      passageMd: currentDisplay(node).md,
      langLabel: langLabel(),
      wantVideo: true,
      signal: llm.begin(),
    });
    const sources = parseSources(raw, newId, searched);
    // Merge rather than replace: asking twice should widen what is behind a
    // passage, not quietly drop what the first search found.
    const existing = useGraphStore.getState().nodes[nodeId]?.sources ?? [];
    const seen = new Set(existing.map((s) => s.videoId ?? s.url));
    useGraphStore
      .getState()
      .setSources(nodeId, [...existing, ...sources.filter((s) => !seen.has(s.videoId ?? s.url))]);
  } catch (err) {
    if (!isAbort(err)) useLlmStore.getState().noteFallback(err);
  } finally {
    useLlmStore.getState().end();
    useSourceStore.getState().end();
  }
}
