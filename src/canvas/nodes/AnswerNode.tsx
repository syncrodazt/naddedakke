import { useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { RFlowNode } from '../../store/selectors';
import { useStrings } from '../../i18n';
import { MarkdownContent } from '../../markdown/MarkdownContent';
import { useGraphStore } from '../../store/graphStore';
import { useCameraNav } from '../useCameraNav';
import { NodeShell } from './NodeShell';
import { useResolvedHighlights } from './useResolvedHighlights';
import { useDisplayContent } from '../../store/displayContent';

export function AnswerNode({ data, selected }: NodeProps<RFlowNode>) {
  const strings = useStrings();
  const { node, displayNum } = data;
  const streaming = useGraphStore((s) => s.streamingNodeId === node.id);
  const { panToNode } = useCameraNav();

  const display = useDisplayContent(node);
  const resolvedIds = useResolvedHighlights(display.highlights);

  const onHighlightClick = useCallback(
    (highlightId: string) => {
      const child = display.highlights.find((h) => h.id === highlightId)?.childNodeId;
      if (child) panToNode(child);
    },
    [display, panToNode],
  );

  const addIdea = useCallback(() => {
    panToNode(useGraphStore.getState().addIdeaBranch(node.id));
  }, [node.id, panToNode]);

  return (
    <NodeShell
      nodeId={node.id}
      displayNum={displayNum}
      selected={selected}
      label={streaming ? strings.thinking : strings.answerLabel}
      accent="alias"
      showUnderstood
      onAddIdea={addIdea}
    >
      <MarkdownContent
        nodeId={node.id}
        md={display.md}
        highlights={display.highlights}
        resolvedHighlightIds={resolvedIds}
        onHighlightClick={onHighlightClick}
      />
    </NodeShell>
  );
}
