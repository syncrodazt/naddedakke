import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useUIStore, type Dialog } from '../store/uiStore';
import { strings } from '../strings';
import styles from './DialogHost.module.css';

// Renders the active in-page dialog (alert / confirm / prompt). Mounted once.
// Cancelling (Cancel button, Esc, or backdrop click) resolves to the "negative"
// value: false for confirm, null for prompt, void for alert.
export function DialogHost() {
  const dialog = useUIStore((s) => s.dialog);
  if (!dialog) return null;
  // Keyed so each new dialog remounts DialogView with fresh initial state.
  return <DialogView key={dialog.id} dialog={dialog} />;
}

function DialogView({ dialog }: { dialog: Dialog }) {
  const [text, setText] = useState(dialog.kind === 'prompt' ? dialog.defaultValue : '');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (dialog.kind === 'prompt') inputRef.current?.select();
    else okRef.current?.focus();
  }, [dialog.kind]);

  const cancel = () => {
    if (dialog.kind === 'confirm') dialog.resolve(false);
    else if (dialog.kind === 'prompt') dialog.resolve(null);
    else dialog.resolve();
  };

  const confirm = () => {
    if (dialog.kind === 'confirm') dialog.resolve(true);
    else if (dialog.kind === 'prompt') {
      const value = text.trim();
      dialog.resolve(value === '' ? null : value);
    } else dialog.resolve();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Enter' && (dialog.kind !== 'prompt' || !e.shiftKey)) {
      e.preventDefault();
      confirm();
    }
  };

  const okLabel =
    dialog.kind === 'prompt'
      ? strings.dialogSubmit
      : dialog.kind === 'confirm'
        ? strings.dialogOk
        : strings.dialogClose;
  const danger = dialog.kind === 'confirm' && dialog.danger;

  return createPortal(
    <div className={styles.backdrop} onMouseDown={cancel}>
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <p className={styles.message}>{dialog.message}</p>
        {dialog.kind === 'prompt' && (
          <textarea
            ref={inputRef}
            className={styles.input}
            rows={2}
            value={text}
            placeholder={dialog.placeholder}
            onChange={(e) => setText(e.target.value)}
          />
        )}
        <div className={styles.actions}>
          {dialog.kind !== 'alert' && (
            <button type="button" className={styles.cancel} onClick={cancel}>
              {strings.dialogCancel}
            </button>
          )}
          <button
            ref={okRef}
            type="button"
            className={danger ? styles.danger : styles.ok}
            onClick={confirm}
          >
            {okLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
