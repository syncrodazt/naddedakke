import { createPortal } from 'react-dom';
import { providerOf, useModelStore } from '../store/modelStore';
import { usePanelStore } from '../store/panelStore';
import { LANGS, useLangStore, useStrings, type Lang } from '../i18n';
import { AuthPanel } from './AuthPanel';
import styles from './SettingsDialog.module.css';

/**
 * Ctrl/⌘+, — the settings you set once and forget.
 *
 * Model and language used to sit in the toolbar, where they were permanently
 * in the way of the thing you look at constantly: which notebook you are in.
 */
export function SettingsDialog() {
  const strings = useStrings();
  const open = usePanelStore((s) => s.panel === 'settings');
  const close = usePanelStore((s) => s.close);
  const models = useModelStore((s) => s.available);
  const selectedModel = useModelStore((s) => s.selected);
  const setModel = useModelStore((s) => s.setSelected);
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);

  if (!open) return null;

  return createPortal(
    <div className={styles.backdrop} onMouseDown={close}>
      <div
        className={styles.card}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      >
        <div className={styles.head}>
          <h2 className={styles.title}>{strings.settingsTitle}</h2>
          <button type="button" className={styles.close} onClick={close}>
            {strings.dialogClose}
          </button>
        </div>

        <label className={styles.field}>
          <span className={styles.label}>{strings.languageLabel}</span>
          <span className={styles.segmented}>
            {LANGS.map((l) => (
              <button
                key={l.id}
                type="button"
                className={l.id === lang ? styles.segOn : styles.seg}
                onClick={() => setLang(l.id as Lang)}
              >
                {l.label}
              </button>
            ))}
          </span>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>{strings.modelLabel}</span>
          <select
            className={styles.select}
            value={selectedModel}
            onChange={(e) => setModel(e.target.value)}
          >
            {(['claude', 'gemini'] as const).map((provider) => {
              const group = models.filter((m) => providerOf(m) === provider);
              if (group.length === 0) return null;
              return (
                <optgroup key={provider} label={provider === 'claude' ? 'Claude' : 'Gemini'}>
                  {group.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </label>

        <div className={styles.field}>
          <span className={styles.label}>{strings.cloudTitle}</span>
          <AuthPanel />
        </div>
      </div>
    </div>,
    document.body,
  );
}
