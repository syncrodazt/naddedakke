import type { ReactNode } from 'react';
import { Handle, NodeResizer, Position } from '@xyflow/react';
import { useGraphStore } from '../../store/graphStore';
import styles from './NodeShell.module.css';

type NodeShellProps = {
  nodeId: string;
  seq: number;
  label: string;
  accent?: 'branch' | 'alias' | 'guard';
  children: ReactNode;
  headerExtra?: ReactNode;
};

// Shared card chrome. The header is the drag handle; the body carries `nodrag`
// so selecting text inside a node never drags it. NodeResizer lets the user
// resize; the committed size persists through the store.
export function NodeShell({ nodeId, seq, label, accent, children, headerExtra }: NodeShellProps) {
  return (
    <div className={styles.card} data-accent={accent}>
      <NodeResizer
        minWidth={240}
        minHeight={120}
        color="var(--muted)"
        handleClassName={styles.resizeHandle}
        lineClassName={styles.resizeLine}
        onResizeEnd={(_e, p) =>
          useGraphStore.getState().setNodeSize(nodeId, { width: p.width, height: p.height })
        }
      />
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <div className={`${styles.header} drag-handle`}>
        <span className={styles.seq} title="chronological order">
          #{seq}
        </span>
        <span className={styles.label}>{label}</span>
        {headerExtra}
      </div>
      <div className={`${styles.body} nodrag nowheel`}>{children}</div>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  );
}
