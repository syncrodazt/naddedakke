import type { ReactNode } from 'react';
import { Handle, NodeResizer, Position } from '@xyflow/react';
import { useGraphStore } from '../../store/graphStore';
import { strings } from '../../strings';
import styles from './NodeShell.module.css';

type NodeShellProps = {
  nodeId: string;
  displayNum: number; // contiguous rank shown in the #N badge (renumbers on delete)
  label: string;
  accent?: 'branch' | 'alias' | 'guard';
  children: ReactNode;
  headerExtra?: ReactNode;
  // Learn-mode nodes (chunk/question/answer) get a "分かった / Got it" toggle
  // that marks the node understood, closing the confusion→resolution loop.
  showUnderstood?: boolean;
  // When set, a "+" button appears on hover to branch a free-form idea.
  onAddIdea?: () => void;
};

// Shared card chrome. The header is the drag handle; the body carries `nodrag`
// so selecting text inside a node never drags it. NodeResizer lets the user
// resize; the committed size persists through the store.
export function NodeShell({
  nodeId,
  displayNum,
  label,
  accent,
  children,
  headerExtra,
  showUnderstood,
  onAddIdea,
}: NodeShellProps) {
  const understood = useGraphStore((s) => s.nodes[nodeId]?.understood ?? false);
  const toggleUnderstood = useGraphStore((s) => s.toggleUnderstood);

  return (
    // The wrapper is unclipped so the hover "+" can poke below; the card clips.
    <div className={styles.wrap}>
      <NodeResizer
        minWidth={240}
        minHeight={120}
        color="var(--muted)"
        // Inline styles beat React Flow's own control CSS (higher specificity),
        // so the handles are actually big enough to grab easily.
        handleStyle={{
          width: 14,
          height: 14,
          borderRadius: 4,
          background: 'var(--muted)',
          border: '2px solid var(--card)',
        }}
        lineStyle={{ borderWidth: 4, borderColor: 'transparent' }}
        onResizeEnd={(_e, p) =>
          useGraphStore.getState().setNodeSize(nodeId, { width: p.width, height: p.height })
        }
      />
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <div className={styles.card} data-accent={accent} data-understood={understood || undefined}>
        <div className={`${styles.header} drag-handle`}>
          <span className={styles.seq} title="chronological order">
            #{displayNum}
          </span>
          <span className={styles.label}>{label}</span>
          {headerExtra}
          {showUnderstood && (
            <button
              type="button"
              className={`${styles.understood} nodrag`}
              data-on={understood || undefined}
              title={strings.understoodTitle}
              onClick={() => toggleUnderstood(nodeId)}
            >
              {understood ? '✓ ' : ''}
              {strings.gotIt}
            </button>
          )}
        </div>
        <div className={`${styles.body} nodrag nowheel`}>{children}</div>
      </div>
      {onAddIdea && (
        <button
          type="button"
          className={`${styles.addIdea} nodrag`}
          title={strings.newIdea}
          onClick={onAddIdea}
        >
          +
        </button>
      )}
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  );
}
