import { createPortal } from 'react-dom';
import { useStrings } from '../i18n';
import type { ActiveSelection } from './useTextSelection';
import styles from './WhyButton.module.css';

type WhyButtonProps = {
  selection: ActiveSelection;
  onAct: (selection: ActiveSelection, intent: 'why' | 'respond' | 'video') => void;
};

// Medium-style floating pill above the current text selection, with three
// actions: なんで？ (ask why), 答える (submit your own answer for feedback), and
// 🎬 (be shown this phrase instead of told it).
//
// The video sits here rather than only in a menu because it is the same
// gesture as the other two — this sentence, do something with it — and because
// "I can't picture this" arrives while reading a specific line, not while
// thinking about the card as a whole.
export function WhyButton({ selection, onAct }: WhyButtonProps) {
  const strings = useStrings();
  const { rect } = selection;
  return createPortal(
    <div
      // Marks the pill as part of the selection, so the outside-press handler
      // that dismisses it does not dismiss it on the way to being clicked.
      data-why-button
      className={styles.pill}
      style={{ top: rect.top - 44, left: rect.left + rect.width / 2 }}
    >
      <button
        type="button"
        className={styles.why}
        // Fire before the browser collapses the selection on mousedown.
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onAct(selection, 'why');
        }}
      >
        {strings.nande}
      </button>
      <button
        type="button"
        className={styles.respond}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onAct(selection, 'respond');
        }}
      >
        {strings.respond}
      </button>
      <button
        type="button"
        className={styles.video}
        title={strings.showVideoTitle}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onAct(selection, 'video');
        }}
      >
        {strings.showVideo}
      </button>
    </div>,
    document.body,
  );
}
