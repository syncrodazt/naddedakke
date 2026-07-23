import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { strings } from '../strings';
import styles from './AuthPanel.module.css';

// Login / signup control for the toolbar. Renders nothing when the cloud is not
// configured (no Supabase env vars) — the app stays purely local in that case.
export function AuthPanel() {
  const enabled = useAuthStore((s) => s.enabled);
  const user = useAuthStore((s) => s.user);
  const busy = useAuthStore((s) => s.busy);
  const error = useAuthStore((s) => s.error);
  const info = useAuthStore((s) => s.info);
  const signIn = useAuthStore((s) => s.signIn);
  const signUp = useAuthStore((s) => s.signUp);
  const signOut = useAuthStore((s) => s.signOut);
  const clearMessages = useAuthStore((s) => s.clearMessages);

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!enabled) return null;

  if (user) {
    return (
      <div className={styles.authed} title={strings.cloudSynced}>
        <span className={styles.cloudIcon}>☁</span>
        <span className={styles.email}>{user.email}</span>
        <button
          type="button"
          className={styles.linkButton}
          onClick={() => {
            setOpen(false);
            void signOut();
          }}
          disabled={busy}
        >
          {strings.signOut}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.wrap} ref={popoverRef}>
      <button
        type="button"
        className={styles.loginButton}
        onClick={() => {
          clearMessages();
          setOpen((o) => !o);
        }}
      >
        ☁ {strings.signIn}
      </button>
      {open && (
        <div className={styles.popover}>
          <div className={styles.title}>{strings.cloudTitle}</div>
          <input
            className={styles.field}
            type="email"
            placeholder={strings.emailPlaceholder}
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className={styles.field}
            type="password"
            placeholder={strings.passwordPlaceholder}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              disabled={busy || !email || !password}
              onClick={() => void signIn(email, password)}
            >
              {strings.signIn}
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy || !email || !password}
              onClick={() => void signUp(email, password)}
            >
              {strings.signUp}
            </button>
          </div>
          {error && <div className={styles.error}>{error}</div>}
          {info && <div className={styles.info}>{info}</div>}
        </div>
      )}
    </div>
  );
}
