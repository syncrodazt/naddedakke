import { useCallback, useMemo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { RFlowNode } from '../../store/selectors';
import { strings } from '../../strings';
import { MarkdownContent } from '../../markdown/MarkdownContent';
import { useGraphStore } from '../../store/graphStore';
import { useCameraNav } from '../useCameraNav';
import { NodeShell } from './NodeShell';

export function AnswerNode({ data }: NodeProps<RFlowNode>) {
  const { node } = data;
  const streaming = useGraphStore((s) => s.streamingNodeId === node.id);
  const nodes = useGraphStore((s) => s.nodes);
  const { panToNode } = useCameraNav();

  const resolvedIds = useMemo(
    () =>
      node.content.highlights
        .filter((h) => h.childNodeId && nodes[h.childNodeId]?.understood)
        .map((h) => h.id),
    [node.content.highlights, nodes],
  );

  const onHighlightClick = useCallback(
    (highlightId: string) => {
      const child = node.content.highlights.find((h) => h.id === highlightId)?.childNodeId;
      if (child) panToNode(child);
    },
    [node, panToNode],
  );

  const addIdea = useCallback(() => {
    panToNode(useGraphStore.getState().addIdeaBranch(node.id));
  }, [node.id, panToNode]);

  return (
    <NodeShell
      nodeId={node.id}
      seq={node.seq}
      label={streaming ? strings.thinking : strings.answerLabel}
      accent="alias"
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
    </NodeShell>
  );
}
