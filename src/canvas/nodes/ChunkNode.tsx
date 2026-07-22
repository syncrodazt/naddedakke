import { useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { RFlowNode } from '../../store/selectors';
import { strings } from '../../strings';
import { MarkdownContent } from '../../markdown/MarkdownContent';
import { useGraphStore } from '../../store/graphStore';
import { useCameraNav } from '../useCameraNav';
import { NodeShell } from './NodeShell';

export function ChunkNode({ data }: NodeProps<RFlowNode>) {
  const { node } = data;
  const streaming = useGraphStore((s) => s.streamingNodeId === node.id);
  const { panToNode } = useCameraNav();

  const onHighlightClick = useCallback(
    (highlightId: string) => {
      const child = node.content.highlights.find((h) => h.id === highlightId)?.childNodeId;
      if (child) panToNode(child);
    },
    [node, panToNode],
  );

  return (
    <NodeShell label={streaming ? strings.thinking : strings.chunkLabel}>
      <MarkdownContent
        nodeId={node.id}
        md={node.content.md}
        highlights={node.content.highlights}
        onHighlightClick={onHighlightClick}
      />
    </NodeShell>
  );
}
