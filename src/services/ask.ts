import { useGraphStore } from '../store/graphStore';
import { teachService } from './claude';

/** The ancestor chain (root chunk → … → parent), NOT the whole graph. */
export function ancestorChainMd(nodeId: string): string {
  const { nodes, edges } = useGraphStore.getState();
  const chain: string[] = [];
  let current: string | undefined = nodeId;
  const guard = new Set<string>();
  while (current && !guard.has(current)) {
    guard.add(current);
    const node = nodes[current];
    if (node) chain.unshift(node.content.md);
    const incoming = Object.values(edges).find(
      (e) => e.target === current && (e.kind === 'why' || e.kind === 'reply' || e.kind === 'next'),
    );
    current = incoming?.source;
  }
  return chain.join('\n\n---\n\n');
}

/**
 * Finalize a pending question, create its answer node, and stream the
 * (mock) Claude reply into it. Returns the answer node id.
 */
export async function askQuestion(questionId: string, questionText: string): Promise<string> {
  const store = useGraphStore.getState();
  const { session, nodes, edges } = store;
  if (!session) throw new Error('no active session');

  const whyEdge = Object.values(edges).find((e) => e.target === questionId && e.kind === 'why');
  const parent = whyEdge ? nodes[whyEdge.source] : undefined;
  const quotedText =
    parent?.content.highlights.find((h) => h.childNodeId === questionId)?.text ?? '';
  const contextMd = parent ? ancestorChainMd(parent.id) : '';

  const answerId = store.submitQuestion(questionId, questionText);
  try {
    const stream = teachService.streamAnswer({
      sessionId: session.id,
      question: questionText,
      quotedText,
      contextMd,
    });
    for await (const delta of stream) {
      useGraphStore.getState().appendToNode(answerId, delta);
    }
  } finally {
    useGraphStore.getState().finishStreaming();
  }
  return answerId;
}
