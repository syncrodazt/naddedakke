import type { NodeProps } from '@xyflow/react';
import type { RFlowNode } from '../../store/selectors';
import { strings } from '../../strings';
import { MarkdownContent } from '../../markdown/MarkdownContent';
import { NodeShell } from './NodeShell';
import styles from './GyakusanNodes.module.css';

export function GoalNode({ data }: NodeProps<RFlowNode>) {
  const { node } = data;
  return (
    <NodeShell label={strings.goalLabel} accent="guard">
      <MarkdownContent nodeId={node.id} md={node.content.md} highlights={node.content.highlights} />
      {node.value !== undefined && (
        <div key={node.value} className={styles.value}>
          {node.value.toLocaleString('ja-JP', { maximumFractionDigits: 1 })}
          <span className={styles.unit}>{node.unit}</span>
        </div>
      )}
    </NodeShell>
  );
}
