import { useCallback, useMemo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { RFlowNode } from '../../store/selectors';
import { strings } from '../../strings';
import { MarkdownContent } from '../../markdown/MarkdownContent';
import { useGraphStore } from '../../store/graphStore';
import { findCheckRange } from '../../services/checkQuestion';
import { useCameraNav } from '../useCameraNav';
import { NodeShell } from './NodeShell';
import styles from './ChunkNode.module.css';

export function ChunkNode({ data }: NodeProps<RFlowNode>) {
  const { node } = data;
  const streaming = useGraphStore((s) => s.streamingNodeId === node.id);
  const nodes = useGraphStore((s) => s.nodes);
  const { panToNode } = useCameraNav();

  // Highlights whose spawned question has been marked understood — render teal
  // (confusion resolved) instead of pink.
  const resolvedIds = useMemo(
    () =>
      node.content.highlights
        .filter((h) => h.childNodeId && nodes[h.childNodeId]?.understood)
        .map((h) => h.id),
    [node.content.highlights, nodes],
  );

  // The Socratic comprehension-check ("> ❓ …") at the end of the chunk.
  const check = useMemo(() => findCheckRange(node.content.md), [node.content.md]);
  // Whether the learner has already answered this check (a respond branch that
  // anchors inside the check range).
  const answered = useMemo(
    () =>
      check !== null &&
      node.content.highlights.some((h) => h.start >= check.start && h.end <= check.end),
    [check, node.content.highlights],
  );

  const onHighlightClick = useCallback(
    (highlightId: string) => {
      const child = node.content.highlights.find((h) => h.id === highlightId)?.childNodeId;
      if (child) panToNode(child);
    },
    [node, panToNode],
  );

  const answerCheck = useCallback(() => {
    if (!check) return;
    const questionId = useGraphStore.getState().addWhyBranch(node.id, check, 'respond');
    panToNode(questionId);
  }, [check, node.id, panToNode]);

  const addIdea = useCallback(() => {
    panToNode(useGraphStore.getState().addIdeaBranch(node.id));
  }, [node.id, panToNode]);

  return (
    <NodeShell
      nodeId={node.id}
      seq={node.seq}
      label={streaming ? strings.thinking : strings.chunkLabel}
      showUnderstood
      onAddIdea={addIdea}
    >
      <MarkdownContent
        nodeId={node.id}
        md={node.content.md}
        highlights={node.content.highlights}
        resolvedHighlightIds={resolvedIds}
        onHighlightClick={onHighlightClick}
      />
      {check && !streaming && !answered && (
        <button type="button" className={`${styles.checkButton} nodrag`} onClick={answerCheck}>
          {strings.checkUnderstanding}
        </button>
      )}
    </NodeShell>
  );
}
