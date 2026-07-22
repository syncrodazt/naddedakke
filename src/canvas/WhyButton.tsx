import { createPortal } from 'react-dom';
import { strings } from '../strings';
import type { ActiveSelection } from './useTextSelection';
import styles from './WhyButton.module.css';

type WhyButtonProps = {
  selection: ActiveSelection;
  onAsk: (selection: ActiveSelection) => void;
};

// Medium-style floating pill above the current text selection.
export function WhyButton({ selection, onAsk }: WhyButtonProps) {
  const { rect } = selection;
  return createPortal(
    <button
      type="button"
      className={styles.why}
      style={{ top: rect.top - 44, left: rect.left + rect.width / 2 }}
      // Fire before the browser collapses the selection on mousedown.
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onAsk(selection);
      }}
    >
      {strings.nande}
    </button>,
    document.body,
  );
}
