import { useGraphStore } from '../store/graphStore';
import { currentDisplay } from '../store/displayContent';
import { mockService, teachService } from './claude';
import type { AnswerRequest } from './claude/types';
import { withFallback } from './stream';
import { isAbort, useLlmStore } from '../store/llmStore';
import { pauseHistory, resumeHistory } from '../store/history';

/** The ancestor chain (root chunk → … → parent), NOT the whole graph. */
export function ancestorChainMd(nodeId: string): string {
  const { nodes, edges } = useGraphStore.getState();
  const chain: string[] = [];
  let current: string | undefined = nodeId;
  const guard = new Set<string>();
  while (current && !guard.has(current)) {
    guard.add(current);
    const node = nodes[current];
    // The displayed body, not the original: the ancestor chain is what tells
    // the model which language to answer in, so a learner reading in Thai gets
    // a Thai answer without a separate instruction.
    if (node) chain.unshift(currentDisplay(node).md);
    const incoming = Object.values(edges).find(
      (e) => e.target === current && (e.kind === 'why' || e.kind === 'reply' || e.kind === 'next'),
    );
    current = incoming?.source;
  }
  return chain.join('\n\n---\n\n');
}

/**
 * Finalize a pending question, create its answer node, and stream the LLM
 * reply into it. `intent` picks the prompt: 'why' explains the highlight,
 * 'respond' gives feedback on the learner's own answer. Returns the answer id.
 */
export async function askQuestion(
  questionId: string,
  questionText: string,
  intent: 'why' | 'respond' = 'why',
): Promise<string> {
  const store = useGraphStore.getState();
  const { session, nodes, edges } = store;
  if (!session) throw new Error('no active session');

  const whyEdge = Object.values(edges).find((e) => e.target === questionId && e.kind === 'why');
  const parent = whyEdge ? nodes[whyEdge.source] : undefined;
  const quotedText =
    (parent ? currentDisplay(parent).highlights : []).find((h) => h.childNodeId === questionId)
      ?.text ?? '';
  const contextMd = parent ? ancestorChainMd(parent.id) : '';

  // Recorded while history is still live, so undo removes the answer node.
  const answerId = store.submitQuestion(questionId, questionText);

  const llm = useLlmStore.getState();
  const req: AnswerRequest = {
    sessionId: session.id,
    question: questionText,
    quotedText,
    contextMd,
    intent,
    signal: llm.begin(),
  };
  // A streamed reply writes to the store per token; recording those would bury
  // the learner's own edits under hundreds of undo steps.
  pauseHistory();
  try {
    const stream = withFallback(
      teachService.streamAnswer(req),
      () => mockService.streamAnswer(req),
      llm.noteFallback,
    );
    for await (const delta of stream) {
      // Checking here (not just on the fetch) means Stop also halts a mock
      // fallback stream, which no AbortSignal reaches.
      if (req.signal?.aborted) break;
      useGraphStore.getState().appendToNode(answerId, delta);
    }
  } catch (err) {
    if (!isAbort(err)) throw err; // cancelling keeps whatever streamed so far
  } finally {
    useLlmStore.getState().end();
    useGraphStore.getState().finishStreaming();
    resumeHistory();
  }
  return answerId;
}
