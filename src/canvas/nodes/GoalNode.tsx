import { useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { RFlowNode } from '../../store/selectors';
import { useStrings } from '../../i18n';
import { MarkdownContent } from '../../markdown/MarkdownContent';
import { useGraphStore } from '../../store/graphStore';
import { useCameraNav } from '../useCameraNav';
import { NodeShell } from './NodeShell';
import styles from './GyakusanNodes.module.css';

export function GoalNode({ data, selected }: NodeProps<RFlowNode>) {
  const strings = useStrings();
  const { node, displayNum } = data;
  const { panToNode } = useCameraNav();
  const addIdea = useCallback(() => {
    panToNode(useGraphStore.getState().addIdeaBranch(node.id));
  }, [node.id, panToNode]);

  return (
    <NodeShell
      nodeId={node.id}
      displayNum={displayNum}
      selected={selected}
      label={strings.goalLabel}
      accent="guard"
      showUnderstood
      onAddIdea={addIdea}
    >
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
