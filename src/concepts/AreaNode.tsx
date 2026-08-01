import type { CSSProperties } from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import styles from './ConceptTree.module.css';

export type AreaFlowNode = Node<{ area: string; hue: number }>;

/**
 * The background zone behind one subject.
 *
 * A plain node with a negative z-index rather than a React Flow group: it needs
 * no parent-child relationship, nothing is dragged into it, and it must never
 * be selectable — clicking a subject means clicking the space between cards,
 * which is how you clear the selection.
 */
export function AreaNode({ data }: NodeProps<AreaFlowNode>) {
  return (
    <div className={styles.band} style={{ '--band-hue': data.hue } as CSSProperties}>
      <span className={styles.bandLabel}>{data.area}</span>
    </div>
  );
}
