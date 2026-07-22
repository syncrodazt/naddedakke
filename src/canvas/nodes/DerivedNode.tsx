import type { NodeProps } from '@xyflow/react';
import type { RFlowNode } from '../../store/selectors';
import { strings } from '../../strings';
import { MarkdownContent } from '../../markdown/MarkdownContent';
import { useGraphStore } from '../../store/graphStore';
import { CYCLE_ISSUE } from '../../gyakusan/engine';
import { NodeShell } from './NodeShell';
import styles from './GyakusanNodes.module.css';

function formatValue(value: number): string {
  if (Math.abs(value) >= 100) return Math.round(value).toLocaleString('ja-JP');
  return value.toLocaleString('ja-JP', { maximumFractionDigits: 1 });
}

export function DerivedNode({ data }: NodeProps<RFlowNode>) {
  const { node } = data;
  const issue = useGraphStore((s) => s.computeIssues[node.id]);

  return (
    <NodeShell label={strings.derivedLabel} accent="alias">
      <MarkdownContent nodeId={node.id} md={node.content.md} highlights={node.content.highlights} />
      {issue !== undefined ? (
        <span className={styles.errorBadge}>
          {issue === CYCLE_ISSUE ? strings.cycleError : strings.computeError}
        </span>
      ) : (
        // Keyed by value so the pulse animation replays on every change.
        <div key={node.value} className={styles.value}>
          {formatValue(node.value ?? 0)}
          <span className={styles.unit}>{node.unit}</span>
        </div>
      )}
      {node.formula !== undefined && <code className={styles.formula}>{node.formula}</code>}
    </NodeShell>
  );
}
