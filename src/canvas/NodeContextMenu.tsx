import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useGraphStore } from '../store/graphStore';
import { collectSubtree } from '../store/subtree';
import { confirmDialog } from '../store/uiStore';
import { useStrings } from '../i18n';
import { decomposeNode } from '../services/goal';
import { findSourcesFor } from '../sources/find';
import { findVideoFor } from '../sources/video';
import { makeVisualFor } from '../visual/generate';
import styles from './NodeContextMenu.module.css';

export type MenuState = { x: number; y: number; nodeId: string };

type NodeContextMenuProps = {
  menu: MenuState;
  onClose: () => void;
  onNewIdea: (nodeId: string) => void;
  onNextChunk: () => void;
  onRegenerate: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onPrerequisite: (nodeId: string) => void;
};

// Right-click menu on a node: branch a free-form idea, advance the lesson,
// regenerate the model output, toggle understood, or delete the node (+subtree).
export function NodeContextMenu({
  menu,
  onClose,
  onNewIdea,
  onNextChunk,
  onRegenerate,
  onDelete,
  onPrerequisite,
}: NodeContextMenuProps) {
  const strings = useStrings();
  const session = useGraphStore((s) => s.session);
  const lessonComplete = useGraphStore((s) => s.lessonComplete);
  const streaming = useGraphStore((s) => s.streamingNodeId !== null);
  const node = useGraphStore((s) => s.nodes[menu.nodeId]);
  const edges = useGraphStore((s) => s.edges);
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
  // Every node kind can be branched from and marked understood — gyakusan
  // notebooks use the same system as learn notebooks, and a video node carries
  // a real caption you can question.
  const isLearnContent = true;
  // Not gated on session.mode: a notebook is one canvas, and asking for the
  // next lesson step beside a set of numbers is a reasonable thing to want.
  const canAdvance = session !== null && !lessonComplete && !streaming;
  const canRegenerate = (node.kind === 'chunk' || node.kind === 'answer') && !streaming;
  // Back-cast is the mirror of なんで？: instead of branching a question
  // downstream off a phrase, it generates the quantities this node follows
  // FROM. Only meaningful for the gyakusan node kinds, which carry values and
  // formulas — a prose chunk has no inputs to compute it from.
  // Backwards thinking on any node — only what "before" MEANS differs. For a
  // quantity it is the inputs it is computed from; for prose it is the concept
  // you must already hold to follow it.
  const isQuantity = node.kind === 'goal' || node.kind === 'derived' || node.kind === 'variable';
  const isProse =
    node.kind === 'chunk' ||
    node.kind === 'answer' ||
    node.kind === 'question' ||
    node.kind === 'video' ||
    node.kind === 'visual';
  const canBackcast = (isQuantity || isProse) && !streaming;
  // Anything with prose in it has claims in it, and a claim is the thing a
  // source is for. A bare number does not.
  const canFindSources = isProse && !streaming;

  function handleDelete() {
    const count = collectSubtree(menu.nodeId, edges).size;
    const message = count > 1 ? strings.deleteConfirmMany(count) : strings.deleteConfirmOne;
    const nodeId = menu.nodeId;
    onClose();
    void confirmDialog(message, { danger: true }).then((ok) => {
      if (ok) onDelete(nodeId);
    });
  }

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
      {canBackcast && (
        <button
          type="button"
          className={styles.item}
          onClick={() => {
            const nodeId = menu.nodeId;
            onClose();
            if (isQuantity) void decomposeNode(nodeId);
            else onPrerequisite(nodeId);
          }}
        >
          {isQuantity ? strings.decomposeNode : strings.prerequisite}
        </button>
      )}
      {canFindSources && (
        <button
          type="button"
          className={styles.item}
          onClick={() => {
            const nodeId = menu.nodeId;
            onClose();
            void makeVisualFor(nodeId);
          }}
        >
          {strings.visualMenu}
        </button>
      )}
      {canFindSources && (
        <button
          type="button"
          className={styles.item}
          onClick={() => {
            const nodeId = menu.nodeId;
            onClose();
            void findVideoFor(nodeId);
          }}
        >
          {strings.showVideoMenu}
        </button>
      )}
      {canFindSources && (
        <button
          type="button"
          className={styles.item}
          onClick={() => {
            const nodeId = menu.nodeId;
            onClose();
            void findSourcesFor(nodeId);
          }}
        >
          {node.sources?.length ? strings.findMoreSources : strings.findSources}
        </button>
      )}
      {canRegenerate && (
        <button
          type="button"
          className={styles.item}
          onClick={() => {
            onRegenerate(menu.nodeId);
            onClose();
          }}
        >
          {strings.regenerate}
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
      <button type="button" className={`${styles.item} ${styles.danger}`} onClick={handleDelete}>
        {strings.deleteNode}
      </button>
    </div>,
    document.body,
  );
}
