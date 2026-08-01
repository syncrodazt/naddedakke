import { useEffect, useMemo, useState } from 'react';
import type { Session } from '../model/types';
import { db } from '../db/db';
import { useGraphStore } from '../store/graphStore';
import { useAuthStore } from '../store/authStore';
import { useLibraryStore } from './libraryStore';
import { useStrings } from '../i18n';
import { promptDialog } from '../store/uiStore';
import { startLesson } from '../services/lesson';
import { groupSessions } from './grouping';
import styles from './Sidebar.module.css';

/**
 * Notebooks, alongside the canvas rather than instead of it.
 *
 * The library answers "what was I working on?" but costs you the canvas to ask.
 * This answers "let me jump to that other one" without leaving what you are
 * looking at — which is the move you make constantly and the full-screen list
 * makes expensive. Ctrl/⌘+B, the same key every editor uses for this.
 */
export function Sidebar() {
  const strings = useStrings();
  const currentId = useGraphStore((s) => s.session?.id);
  const sessionsRevision = useGraphStore((s) => s.sessionsRevision);
  const syncNonce = useAuthStore((s) => s.syncNonce);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void db.sessions.toArray().then((rows) => {
      if (cancelled) return;
      setNow(Date.now());
      setSessions(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionsRevision, syncNonce, currentId]);

  const groups = useMemo(() => groupSessions(sessions, now), [sessions, now]);

  async function handleNew() {
    const topic = (await promptDialog(strings.topicPrompt, '', strings.topicPlaceholder))?.trim();
    if (!topic) return;
    await startLesson(topic);
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.head}>
        <button type="button" className={styles.new} onClick={() => void handleNew()}>
          ＋ {strings.paletteNew}
        </button>
      </div>

      <nav className={styles.scroll}>
        {groups.map((group) => (
          <div key={group.key} className={styles.group}>
            <h3 className={styles.heading}>
              {group.bucket === 'today'
                ? strings.libraryToday
                : group.bucket === 'yesterday'
                  ? strings.libraryYesterday
                  : new Date(group.dayStart).toLocaleDateString()}
            </h3>
            {group.sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                className={session.id === currentId ? styles.itemOn : styles.item}
                title={session.title || session.id}
                onClick={() => void useGraphStore.getState().loadSession(session.id)}
              >
                {session.title || session.id}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <button
        type="button"
        className={styles.foot}
        onClick={() => useLibraryStore.getState().show('next')}
      >
        {strings.nextUpNav}
      </button>
      <button
        type="button"
        className={styles.foot}
        onClick={() => useLibraryStore.getState().show('library')}
      >
        {strings.libraryBack}
      </button>
    </aside>
  );
}
