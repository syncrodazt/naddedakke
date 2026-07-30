import { useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { RFlowNode } from '../../store/selectors';
import { useStrings } from '../../i18n';
import { MarkdownContent } from '../../markdown/MarkdownContent';
import { useGraphStore } from '../../store/graphStore';
import { playgroundRegistry } from '../../playgrounds/registry';
import { NodeShell } from './NodeShell';
import { useDisplayContent } from '../../store/displayContent';

export function PlaygroundNode({ data, selected }: NodeProps<RFlowNode>) {
  const strings = useStrings();
  const { node, displayNum } = data;
  const display = useDisplayContent(node);
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
      selected={selected}
      label={strings.playgroundLabel}
      accent="guard"
    >
      {display.md !== '' && (
        <MarkdownContent nodeId={node.id} md={display.md} highlights={node.content.highlights} />
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
