import { useRemoteStore } from '../store/remoteStore';
import { useAuthStore } from '../store/authStore';
import { useStrings } from '../i18n';
import styles from './SyncIndicator.module.css';

/**
 * Auto-sync, made visible. Silent auto-updating is unsettling — the graph
 * changes and the learner has no idea why — so an applied remote change flashes
 * briefly, and one that is waiting for an idle moment says so rather than
 * looking like nothing happened.
 */
export function SyncIndicator() {
  const strings = useStrings();
  const user = useAuthStore((s) => s.user);
  const waiting = useRemoteStore((s) => s.pending.length);
  const flashing = useRemoteStore((s) => s.flashing);

  if (!user) return null;
  if (waiting === 0 && !flashing) return null;

  const pending = waiting > 0;
  return (
    <div
      className={pending ? styles.waiting : styles.applied}
      role="status"
      title={strings.cloudLive}
    >
      {pending ? `⏳ ${strings.cloudLiveWaiting}` : `☁ ${strings.cloudLiveApplied}`}
    </div>
  );
}
