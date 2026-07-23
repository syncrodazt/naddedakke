import type { NodeProps } from '@xyflow/react';
import type { RFlowNode } from '../../store/selectors';
import { strings } from '../../strings';
import { MarkdownContent } from '../../markdown/MarkdownContent';
import { useGraphStore } from '../../store/graphStore';
import { NodeShell } from './NodeShell';
import styles from './GyakusanNodes.module.css';

export function VariableNode({ data }: NodeProps<RFlowNode>) {
  const { node, displayNum } = data;
  const setVariableValue = useGraphStore((s) => s.setVariableValue);
  const value = node.value ?? 0;
  const input = node.varInput ?? { min: 0, max: 100, step: 1 };

  return (
    <NodeShell nodeId={node.id} displayNum={displayNum} label={strings.variableLabel}>
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
