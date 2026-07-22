import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useGraphStore } from '../store/graphStore';
import { strings } from '../strings';
import styles from './NodeContextMenu.module.css';

export type MenuState = { x: number; y: number; nodeId: string };

type NodeContextMenuProps = {
  menu: MenuState;
  onClose: () => void;
  onNewIdea: (nodeId: string) => void;
  onNextChunk: () => void;
};

// Right-click menu on a node: branch a free-form idea, advance the lesson,
// or toggle the node's understood state.
export function NodeContextMenu({ menu, onClose, onNewIdea, onNextChunk }: NodeContextMenuProps) {
  const session = useGraphStore((s) => s.session);
  const lessonComplete = useGraphStore((s) => s.lessonComplete);
  const streaming = useGraphStore((s) => s.streamingNodeId !== null);
  const node = useGraphStore((s) => s.nodes[menu.nodeId]);
  const toggleUnderstood = useGraphStore((s) => s.toggleUnderstood);

  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', close);
    };
  }, [onClose]);

  if (!node) return null;
  const isLearnContent =
    node.kind === 'chunk' || node.kind === 'question' || node.kind === 'answer';
  const canAdvance = session?.mode === 'learn' && !lessonComplete && !streaming;

  return createPortal(
    <div className={styles.menu} style={{ top: menu.y, left: menu.x }}>
      {isLearnContent && (
        <button
          type="button"
          className={styles.item}
          onClick={() => {
            onNewIdea(menu.nodeId);
            onClose();
          }}
        >
          {strings.newIdea}
        </button>
      )}
      {canAdvance && (
        <button
          type="button"
          className={styles.item}
          onClick={() => {
            onNextChunk();
            onClose();
          }}
        >
          {strings.nextChunkMenu}
        </button>
      )}
      {isLearnContent && (
        <button
          type="button"
          className={styles.item}
          onClick={() => {
            toggleUnderstood(menu.nodeId);
            onClose();
          }}
        >
          {node.understood ? `✓ ${strings.gotIt}` : strings.gotIt}
        </button>
      )}
    </div>,
    document.body,
  );
}
