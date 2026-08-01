import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useStrings } from '../i18n';
import { useAuthStore } from '../store/authStore';
import { useShareStore } from './shareStore';
import { shareUrl, visibilityOf, type ShareRole } from './link';
import styles from './ShareDialog.module.css';

/**
 * Who can see this notebook, and can they change it.
 *
 * Two links, not one: revoking "can edit" must not also cut off the people who
 * only ever had "can view". Publishing is the same mechanism with the secret
 * made deliberately public, so it lives here rather than as a separate feature.
 */
export function ShareDialog() {
  const strings = useStrings();
  const open = useShareStore((s) => s.open);
  const links = useShareStore((s) => s.links);
  const busy = useShareStore((s) => s.busy);
  const error = useShareStore((s) => s.error);
  const close = useShareStore((s) => s.close);
  const user = useAuthStore((s) => s.user);
  const cloudEnabled = useAuthStore((s) => s.enabled);
  const [copied, setCopied] = useState<string | null>(null);

  if (!open) return null;

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const viewer = links.find((l) => l.role === 'viewer');
  const editor = links.find((l) => l.role === 'editor');
  const visibility = visibilityOf(links);

  async function copy(token: string) {
    const url = shareUrl(origin, token);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(token);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      // Clipboard blocked (insecure origin, permissions): the input below still
      // holds the URL, so selecting it by hand always works.
    }
  }

  function row(role: ShareRole, label: string, hint: string) {
    const link = links.find((l) => l.role === role);
    return (
      <div className={styles.row} key={role}>
        <div className={styles.rowHead}>
          <span className={styles.rowLabel}>{label}</span>
          <span className={styles.rowHint}>{hint}</span>
        </div>
        {link ? (
          <div className={styles.linkLine}>
            <input className={styles.url} readOnly value={shareUrl(origin, link.token)} />
            <button type="button" onClick={() => void copy(link.token)}>
              {copied === link.token ? strings.shareCopied : strings.shareCopy}
            </button>
            <button
              type="button"
              className={styles.danger}
              disabled={busy}
              onClick={() => void useShareStore.getState().revoke(link.token)}
            >
              {strings.shareRevoke}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.create}
            disabled={busy}
            onClick={() => void useShareStore.getState().create(role)}
          >
            {strings.shareCreateLink}
          </button>
        )}
      </div>
    );
  }

  const published = links.some((l) => l.isPublic);

  return createPortal(
    <div className={styles.backdrop} onMouseDown={close}>
      <div
        className={styles.card}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      >
        <div className={styles.head}>
          <h2 className={styles.title}>{strings.shareTitle}</h2>
          <button type="button" className={styles.close} onClick={close}>
            {strings.dialogClose}
          </button>
        </div>

        <p className={styles.state}>
          {visibility === 'private'
            ? strings.sharePrivate
            : visibility === 'public'
              ? strings.sharePublicState
              : strings.shareSharedState}
        </p>

        {!cloudEnabled && <p className={styles.warn}>{strings.shareNeedsCloud}</p>}
        {cloudEnabled && !user && <p className={styles.warn}>{strings.shareNeedsLogin}</p>}

        {cloudEnabled && user && (
          <>
            {row('viewer', strings.shareViewer, strings.shareViewerHint)}
            {row('editor', strings.shareEditor, strings.shareEditorHint)}

            <label className={styles.publish}>
              <input
                type="checkbox"
                checked={published}
                disabled={busy || (!viewer && !editor)}
                onChange={(e) => {
                  // Publishing applies to the read link: putting a notebook on
                  // the open web must never also hand out write access.
                  void useShareStore.getState().setPublic('viewer', e.target.checked);
                }}
              />
              <span>
                <span className={styles.publishLabel}>{strings.sharePublish}</span>
                <span className={styles.rowHint}>{strings.sharePublishHint}</span>
              </span>
            </label>

            {error && <p className={styles.warn}>{strings.shareFailed}</p>}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
