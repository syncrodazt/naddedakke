import { useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { RFlowNode } from '../../store/selectors';
import { strings } from '../../strings';
import { MarkdownContent } from '../../markdown/MarkdownContent';
import { useGraphStore } from '../../store/graphStore';
import { playgroundRegistry } from '../../playgrounds/registry';
import { NodeShell } from './NodeShell';

export function PlaygroundNode({ data }: NodeProps<RFlowNode>) {
  const { node, displayNum } = data;
  const setPlaygroundParams = useGraphStore((s) => s.setPlaygroundParams);

  const onParamsChange = useCallback(
    (params: Record<string, number>) => setPlaygroundParams(node.id, params),
    [node.id, setPlaygroundParams],
  );

  const entry = node.playground ? playgroundRegistry[node.playground.key] : undefined;
  const Component = entry?.component;

  return (
    <NodeShell
      nodeId={node.id}
      displayNum={displayNum}
      label={strings.playgroundLabel}
      accent="guard"
    >
      {node.content.md !== '' && (
        <MarkdownContent
          nodeId={node.id}
          md={node.content.md}
          highlights={node.content.highlights}
        />
      )}
      {Component && node.playground ? (
        <Component
          params={{ ...entry.defaults, ...node.playground.params }}
          onParamsChange={onParamsChange}
        />
      ) : (
        <p>{strings.playgroundMissing}</p>
      )}
    </NodeShell>
  );
}
