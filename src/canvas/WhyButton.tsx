import { createPortal } from 'react-dom';
import { strings } from '../strings';
import type { ActiveSelection } from './useTextSelection';
import styles from './WhyButton.module.css';

type WhyButtonProps = {
  selection: ActiveSelection;
  onAct: (selection: ActiveSelection, intent: 'why' | 'respond') => void;
};

// Medium-style floating pill above the current text selection, with two
// actions: なんで？ (ask why) and 答える (submit your own answer for feedback).
export function WhyButton({ selection, onAct }: WhyButtonProps) {
  const { rect } = selection;
  return createPortal(
    <div className={styles.pill} style={{ top: rect.top - 44, left: rect.left + rect.width / 2 }}>
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
    </div>,
    document.body,
  );
}
