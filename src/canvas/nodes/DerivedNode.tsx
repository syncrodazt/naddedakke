import { useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { RFlowNode } from '../../store/selectors';
import { useStrings } from '../../i18n';
import { MarkdownContent } from '../../markdown/MarkdownContent';
import { useGraphStore } from '../../store/graphStore';
import { CYCLE_ISSUE } from '../../gyakusan/engine';
import { useCameraNav } from '../useCameraNav';
import { NodeShell } from './NodeShell';
import { useDisplayContent } from '../../store/displayContent';
import styles from './GyakusanNodes.module.css';

function formatValue(value: number): string {
  if (Math.abs(value) >= 100) return Math.round(value).toLocaleString('ja-JP');
  return value.toLocaleString('ja-JP', { maximumFractionDigits: 1 });
}

export function DerivedNode({ data, selected }: NodeProps<RFlowNode>) {
  const strings = useStrings();
  const { node, displayNum } = data;
  const display = useDisplayContent(node);
  const issue = useGraphStore((s) => s.computeIssues[node.id]);
  const { panToNode } = useCameraNav();
  const addIdea = useCallback(() => {
    panToNode(useGraphStore.getState().addIdeaBranch(node.id));
  }, [node.id, panToNode]);

  return (
    <NodeShell
      nodeId={node.id}
      displayNum={displayNum}
      selected={selected}
      label={strings.derivedLabel}
      accent="alias"
      showUnderstood
      onAddIdea={addIdea}
    >
      <MarkdownContent nodeId={node.id} md={display.md} highlights={display.highlights} />
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
