import { useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { RFlowNode } from '../../store/selectors';
import { useStrings } from '../../i18n';
import { MarkdownContent } from '../../markdown/MarkdownContent';
import { useGraphStore } from '../../store/graphStore';
import { useCameraNav } from '../useCameraNav';
import { NodeShell } from './NodeShell';
import styles from './GyakusanNodes.module.css';

export function VariableNode({ data, selected }: NodeProps<RFlowNode>) {
  const strings = useStrings();
  const { node, displayNum } = data;
  const setVariableValue = useGraphStore((s) => s.setVariableValue);
  const value = node.value ?? 0;
  const input = node.varInput ?? { min: 0, max: 100, step: 1 };
  const { panToNode } = useCameraNav();
  const addIdea = useCallback(() => {
    panToNode(useGraphStore.getState().addIdeaBranch(node.id));
  }, [node.id, panToNode]);

  return (
    <NodeShell
      nodeId={node.id}
      displayNum={displayNum}
      selected={selected}
      label={strings.variableLabel}
      showUnderstood
      onAddIdea={addIdea}
    >
      <MarkdownContent nodeId={node.id} md={node.content.md} highlights={node.content.highlights} />
      <div className={styles.valueRow}>
        <input
          type="number"
          className={styles.number}
          value={value}
          min={input.min}
          max={input.max}
          step={input.step}
          onChange={(e) => setVariableValue(node.id, Number(e.target.value))}
        />
        <span className={styles.unit}>{node.unit}</span>
      </div>
      <input
        type="range"
        className={styles.range}
        value={value}
        min={input.min}
        max={input.max}
        step={input.step}
        onInput={(e) => setVariableValue(node.id, Number(e.currentTarget.value))}
      />
    </NodeShell>
  );
}
