import type { ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';
import styles from './NodeShell.module.css';

type NodeShellProps = {
  label: string;
  accent?: 'branch' | 'alias' | 'guard';
  children: ReactNode;
  headerExtra?: ReactNode;
};

// Shared card chrome. The header is the drag handle; the body carries `nodrag`
// so selecting text inside a node never drags it.
export function NodeShell({ label, accent, children, headerExtra }: NodeShellProps) {
  return (
    <div className={styles.card} data-accent={accent}>
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <div className={`${styles.header} drag-handle`}>
        <span className={styles.label}>{label}</span>
        {headerExtra}
      </div>
      <div className={`${styles.body} nodrag nowheel`}>{children}</div>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  );
}
