import type { NodeProps } from '@xyflow/react';
import type { RFlowNode } from '../../store/selectors';
import { strings } from '../../strings';
import { MarkdownContent } from '../../markdown/MarkdownContent';
import { NodeShell } from './NodeShell';

export function QuestionNode({ data }: NodeProps<RFlowNode>) {
  return (
    <NodeShell label={strings.questionLabel} accent="branch">
      <MarkdownContent
        nodeId={data.node.id}
        md={data.node.content.md}
        highlights={data.node.content.highlights}
      />
    </NodeShell>
  );
}
