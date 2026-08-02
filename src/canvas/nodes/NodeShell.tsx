import type { ReactNode } from 'react';
import { Handle, NodeResizer, Position } from '@xyflow/react';
import { useGraphStore } from '../../store/graphStore';
import { useReplayStore } from '../../replay/replayStore';
import { useStrings } from '../../i18n';
import styles from './NodeShell.module.css';

type NodeShellProps = {
  nodeId: string;
  displayNum: number; // contiguous rank shown in the #N badge (renumbers on delete)
  label: string;
  // React Flow's selection state — resize handles show only on the selected
  // node (Miro-style), so an idle canvas stays clean.
  selected?: boolean;
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
  selected,
  accent,
  children,
  headerExtra,
  showUnderstood,
  onAddIdea,
}: NodeShellProps) {
  const strings = useStrings();
  const understood = useGraphStore((s) => s.nodes[nodeId]?.understood ?? false);
  const toggleUnderstood = useGraphStore((s) => s.toggleUnderstood);
  // Replay focuses each node as it arrives, which selects it. Selection is the
  // right signal — it is how the canvas says "here" — but the resize handles
  // that normally come with it would be an edit during a read-only playback.
  const replaying = useReplayStore((s) => s.active);

  return (
    // The wrapper is unclipped so the hover "+" can poke below; the card clips.
    <div className={styles.wrap} data-selected={selected || undefined}>
      <NodeResizer
        minWidth={240}
        minHeight={120}
        // Handles appear only while this node is selected. No `color` prop —
        // React Flow applies it after our styles and would repaint the invisible
        // grab lines a solid colour.
        isVisible={selected && !replaying}
        handleStyle={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: 'var(--card)',
          border: '1.5px solid var(--alias)',
          boxShadow: '0 1px 3px rgb(18 32 46 / 0.25)',
        }}
        // A wide, invisible grab zone along each edge: easy to hit, nothing to see.
        lineStyle={{ borderWidth: 6, borderColor: 'transparent' }}
        onResizeEnd={(_e, p) =>
          useGraphStore.getState().setNodeSize(nodeId, { width: p.width, height: p.height })
        }
      />
      {/* Four attachment points, not two. A branch hangs BELOW its parent, so
          an edge that can only leave the right-hand side has to curve back
          round and pass behind the card it came from — which is exactly what it
          used to do. See toFlowEdge for which kind uses which. */}
      <Handle type="target" id="in-l" position={Position.Left} className={styles.handle} />
      <Handle type="target" id="in-t" position={Position.Top} className={styles.handle} />
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
        <div data-node-body className={`${styles.body} nodrag nowheel`}>
          {children}
        </div>
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
      <Handle type="source" id="out-r" position={Position.Right} className={styles.handle} />
      <Handle type="source" id="out-b" position={Position.Bottom} className={styles.handle} />
    </div>
  );
}
