import { useGraphStore } from '../store/graphStore';
import { mockService, teachService } from './claude';
import { LESSON_DONE_MARKER, type AnswerRequest, type LessonChunkRequest } from './claude/types';
import { withFallback } from './stream';
import { ancestorChainMd } from './ask';

// Re-run the model for an existing node, replacing its content in place. Works
// on answer nodes (re-answer the same question) and chunk nodes (regenerate the
// lesson step from the same prior context). Idempotent w.r.t. graph structure —
// no new nodes or edges, so seq and numbering are untouched.

/** The learner's question text sits after the quoted blockquote in a question node. */
function extractQuestionText(md: string): string {
  const sep = md.indexOf('\n\n');
  if (sep === -1) return md.replace(/^>\s?/gm, '').trim();
  return md.slice(sep + 2).trim();
}

async function regenerateAnswer(answerId: string): Promise<void> {
  const store = useGraphStore.getState();
  const { session, nodes, edges } = store;
  if (!session) return;
  const answer = nodes[answerId];
  if (!answer || answer.kind !== 'answer') return;

  const replyEdge = Object.values(edges).find((e) => e.target === answerId && e.kind === 'reply');
  const question = replyEdge ? nodes[replyEdge.source] : undefined;
  if (!question) return;

  const whyEdge = Object.values(edges).find((e) => e.target === question.id && e.kind === 'why');
  const parent = whyEdge ? nodes[whyEdge.source] : undefined;
  const quotedText =
    parent?.content.highlights.find((h) => h.childNodeId === question.id)?.text ?? '';
  const contextMd = parent ? ancestorChainMd(parent.id) : '';
  // 'respond' gives feedback on the learner's answer; 'why' and 'idea' explain.
  const intent: 'why' | 'respond' = question.branchIntent === 'respond' ? 'respond' : 'why';

  const req: AnswerRequest = {
    sessionId: session.id,
    question: extractQuestionText(question.content.md),
    quotedText,
    contextMd,
    intent,
  };

  store.setNodeMd(answerId, '');
  store.setStreamingNode(answerId);
  try {
    const stream = withFallback(teachService.streamAnswer(req), () =>
      mockService.streamAnswer(req),
    );
    for await (const delta of stream) {
      useGraphStore.getState().appendToNode(answerId, delta);
    }
  } finally {
    useGraphStore.getState().finishStreaming();
  }
}

async function regenerateChunk(chunkId: string): Promise<void> {
  const store = useGraphStore.getState();
  const { session, nodes } = store;
  if (!session) return;
  const chunk = nodes[chunkId];
  if (!chunk || chunk.kind !== 'chunk') return;

  const previousChunksMd = Object.values(nodes)
    .filter((n) => n.kind === 'chunk' && n.seq < chunk.seq)
    .sort((a, b) => a.seq - b.seq)
    .map((n) => n.content.md);

  const req: LessonChunkRequest = {
    sessionId: session.id,
    topic: session.title,
    previousChunksMd,
    chunkIndex: previousChunksMd.length,
  };

  store.setNodeMd(chunkId, '');
  store.setStreamingNode(chunkId);
  store.setLessonComplete(false);
  try {
    const stream = withFallback(teachService.streamLessonChunk(req), () =>
      mockService.streamLessonChunk(req),
    );
    for await (const delta of stream) {
      useGraphStore.getState().appendToNode(chunkId, delta);
    }
  } finally {
    useGraphStore.getState().finishStreaming();
  }

  const md = useGraphStore.getState().nodes[chunkId]?.content.md ?? '';
  if (md.trimEnd().endsWith(LESSON_DONE_MARKER)) {
    const stripped = md.trimEnd().slice(0, -LESSON_DONE_MARKER.length).trimEnd();
    useGraphStore.getState().setNodeMd(chunkId, stripped);
    useGraphStore.getState().setLessonComplete(true);
  }
}

/** Regenerate a node's model output in place. No-op for other node kinds. */
export async function reprompt(nodeId: string): Promise<void> {
  const node = useGraphStore.getState().nodes[nodeId];
  if (!node) return;
  if (node.kind === 'answer') return regenerateAnswer(nodeId);
  if (node.kind === 'chunk') return regenerateChunk(nodeId);
}

export { extractQuestionText };
