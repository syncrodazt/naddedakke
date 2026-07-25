import { useLlmStore } from '../store/llmStore';
import { useStrings } from '../i18n';
import styles from './FallbackBanner.module.css';

// Shown when a model call failed and canned offline text was served instead.
// Deliberately loud and manually dismissed: an invented answer that looks real
// is the one failure this app must never hide.
export function FallbackBanner() {
  const strings = useStrings();
  const reason = useLlmStore((s) => s.fallbackReason);
  const dismiss = useLlmStore((s) => s.dismissFallback);

  if (reason === null) return null;

  return (
    <div className={styles.banner} role="alert">
      <span className={styles.icon}>⚠</span>
      <div className={styles.text}>
        <div className={styles.title}>{strings.fallbackTitle}</div>
        <div className={styles.body}>{strings.fallbackBody}</div>
        <code className={styles.reason}>{reason}</code>
      </div>
      <button type="button" className={styles.dismiss} onClick={dismiss}>
        {strings.dismiss}
      </button>
    </div>
  );
}
