import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '../model/types';
import { db } from '../db/db';
import { examples } from '../fixture/examples';
import { useGraphStore } from '../store/graphStore';
import { useAuthStore } from '../store/authStore';
import { useLibraryStore } from './libraryStore';
import { useShareStore } from '../share/shareStore';
import { useStrings, useLangStore } from '../i18n';
import { alertDialog, confirmDialog, promptDialog } from '../store/uiStore';
import { startLesson } from '../services/lesson';
import { exportSession } from '../db/exportImport';
import { flatOrder, groupSessions, lastTouched } from './grouping';
import { DRAG_THRESHOLD_PX, coveredIds, rectBetween } from './rubberBand';
import styles from './Library.module.css';

/** Locale for dates and relative times — follows the interface language. */
const LOCALES: Record<string, string> = { ja: 'ja-JP', th: 'th-TH', en: 'en-GB' };

function formatTime(ms: number, locale: string): string {
  return new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ms: number, locale: string): string {
  return new Date(ms).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * The front door: every notebook, most recently worked on first, grouped by the
 * day it was last touched.
 *
 * This is the screen that answers "what was I in the middle of?" — the question
 * you actually arrive with. The canvas cannot answer it, because it can only
 * show you one notebook at a time.
 */
export function Library() {
  const strings = useStrings();
  const lang = useLangStore((s) => s.lang);
  const locale = LOCALES[lang] ?? 'en-GB';

  const syncNonce = useAuthStore((s) => s.syncNonce);
  const sessionsRevision = useGraphStore((s) => s.sessionsRevision);
  const selected = useLibraryStore((s) => s.selected);
  // A share link that could not be opened lands the visitor here instead; say
  // why, or it looks as though the link simply did nothing.
  const guestError = useShareStore((s) => s.guestError);
  const show = useLibraryStore((s) => s.show);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  // The instant the list was built. Read once alongside the data rather than
  // during render, so every row is bucketed against the same clock — and so a
  // re-render never silently re-files a notebook into a different day.
  const [now, setNow] = useState(0);
  // Re-read on every visit, and whenever a sync or a create lands.
  const [reload, setReload] = useState(0);

  const surface = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const [band, setBand] = useState<{
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await db.sessions.toArray();
      const nodeCounts: Record<string, number> = {};
      await Promise.all(
        rows.map(async (s) => {
          nodeCounts[s.id] = await db.nodes.where('sessionId').equals(s.id).count();
        }),
      );
      if (cancelled) return;
      setNow(Date.now());
      setSessions(rows);
      setCounts(nodeCounts);
    })();
    return () => {
      cancelled = true;
    };
  }, [syncNonce, sessionsRevision, reload]);

  const groups = useMemo(() => groupSessions(sessions, now), [sessions, now]);
  const order = useMemo(() => flatOrder(groups), [groups]);

  // Example notebooks the learner has not opened yet — shown last, so an empty
  // library still has somewhere to go.
  const unopened = useMemo(
    () => examples.filter((ex) => !sessions.some((s) => s.id === ex.id)),
    [sessions],
  );

  const open = useCallback(
    async (id: string) => {
      const known = await useGraphStore.getState().loadSession(id);
      if (!known) {
        const example = examples.find((ex) => ex.id === id);
        if (!example) return;
        // Example fixtures carry fixed timestamps so tests stay deterministic,
        // which would file them under 1 January 1970. Opening one is when it
        // becomes YOUR notebook, so that is the moment it started.
        const startedNow = Date.now();
        await useGraphStore.getState().applyImport({
          ...example.data,
          session: { ...example.data.session, createdAt: startedNow, updatedAt: startedNow },
        });
      }
      show('canvas');
    },
    [show],
  );

  function onRowClick(e: React.MouseEvent, id: string) {
    const store = useLibraryStore.getState();
    if (e.shiftKey) store.extendTo(id, order);
    else if (e.ctrlKey || e.metaKey) store.toggle(id);
    else store.select(id);
  }

  // Rubber band. Only starts on the background — a drag begun on a card would
  // fight the click that opens it.
  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    // Anything you can press is not background. Without this, pressing a button
    // in the selection bar counted as "clicked empty space", cleared the
    // selection, and unmounted the bar before the click could ever land on it —
    // so Share, Export and Delete all did nothing.
    if ((e.target as HTMLElement).closest('[data-card], button, input, [role="toolbar"]')) return;
    const origin = { x: e.clientX, y: e.clientY };
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    const before = new Set(useLibraryStore.getState().selected);
    let dragged = false;

    function move(ev: PointerEvent) {
      const rect = rectBetween(origin, { x: ev.clientX, y: ev.clientY });
      if (!dragged && Math.max(rect.width, rect.height) < DRAG_THRESHOLD_PX) return;
      dragged = true;
      setBand(rect);
      const cards = [...cardRefs.current.entries()].map(([id, el]) => {
        const r = el.getBoundingClientRect();
        return { id, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } };
      });
      const covered = coveredIds(rect, cards);
      useLibraryStore
        .getState()
        .setSelection(additive ? [...new Set([...before, ...covered])] : covered);
    }

    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setBand(null);
      // A press on empty space that never became a drag means "deselect".
      if (!dragged && !additive) useLibraryStore.getState().clearSelection();
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ⌘A selects everything, Escape clears. Ignored while typing so the new-
  // notebook prompt keeps its own behaviour.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        useLibraryStore.getState().selectAll(order);
      } else if (e.key === 'Escape') {
        useLibraryStore.getState().clearSelection();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [order]);

  async function handleNew() {
    const topic = (await promptDialog(strings.topicPrompt, '', strings.topicPlaceholder))?.trim();
    if (!topic) return;
    show('canvas');
    await startLesson(topic);
  }

  async function handleDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!(await confirmDialog(strings.libraryDeleteConfirm(ids.length)))) return;
    setBusy(true);
    try {
      await db.transaction('rw', db.sessions, db.nodes, db.edges, async () => {
        await db.sessions.bulkDelete(ids);
        await db.nodes.where('sessionId').anyOf(ids).delete();
        await db.edges.where('sessionId').anyOf(ids).delete();
      });
      // If the open notebook was one of them, there is nothing to go back to.
      if (ids.includes(useGraphStore.getState().session?.id ?? '')) {
        useGraphStore.setState({ session: null, nodes: {}, edges: {} });
      }
      useLibraryStore.getState().clearSelection();
      setReload((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  async function handleExport() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(true);
    try {
      for (const id of ids) {
        const session = sessions.find((s) => s.id === id);
        if (!session) continue;
        const [nodes, edges] = await Promise.all([
          db.nodes.where('sessionId').equals(id).toArray(),
          db.edges.where('sessionId').equals(id).toArray(),
        ]);
        const payload = exportSession(
          session,
          Object.fromEntries(nodes.map((n) => [n.id, n])),
          Object.fromEntries(edges.map((e) => [e.id, e])),
        );
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${session.title || 'session'}-${session.id}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      await alertDialog(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function groupHeading(bucket: string, dayStart: number): string {
    if (bucket === 'today') return strings.libraryToday;
    if (bucket === 'yesterday') return strings.libraryYesterday;
    return formatDate(dayStart, locale);
  }

  return (
    <div className={styles.screen} ref={surface} onPointerDown={onPointerDown}>
      <header className={styles.header}>
        <h1 className={styles.brand}>{strings.appTitle}</h1>
        <button type="button" className={styles.primary} onClick={() => void handleNew()}>
          ＋ {strings.newLesson}
        </button>
      </header>

      {guestError !== null && (
        <p className={styles.warn} role="alert">
          {strings.guestUnavailable}
        </p>
      )}

      {sessions.length === 0 && unopened.length === 0 && (
        <p className={styles.empty}>{strings.libraryEmpty}</p>
      )}

      {groups.map((group) => (
        <section key={group.key} className={styles.group}>
          <h2 className={styles.groupHeading}>{groupHeading(group.bucket, group.dayStart)}</h2>
          <ul className={styles.list}>
            {group.sessions.map((session) => {
              const touched = lastTouched(session);
              const isSelected = selected.has(session.id);
              return (
                <li key={session.id}>
                  <div
                    data-card
                    ref={(el) => {
                      if (el) cardRefs.current.set(session.id, el);
                      else cardRefs.current.delete(session.id);
                    }}
                    className={isSelected ? styles.cardSelected : styles.card}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={(e) => onRowClick(e, session.id)}
                    onDoubleClick={() => void open(session.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void open(session.id);
                    }}
                  >
                    <span className={styles.cardTitle}>{session.title || session.id}</span>
                    <span className={styles.cardMeta}>
                      <span title={strings.libraryEditedTitle}>
                        {strings.libraryEdited} {formatTime(touched, locale)}
                      </span>
                      <span title={strings.libraryAskedTitle}>
                        {strings.libraryAsked} {formatDate(session.createdAt, locale)}
                      </span>
                      <span>{strings.libraryNodes(counts[session.id] ?? 0)}</span>
                    </span>
                    <button
                      type="button"
                      className={styles.openButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        void open(session.id);
                      }}
                    >
                      {strings.libraryOpen}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {unopened.length > 0 && (
        <section className={styles.group}>
          <h2 className={styles.groupHeading}>{strings.examplesGroup}</h2>
          <ul className={styles.list}>
            {unopened.map((ex) => (
              <li key={ex.id}>
                <div
                  className={styles.exampleCard}
                  role="button"
                  tabIndex={0}
                  data-example
                  onClick={() => void open(ex.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void open(ex.id);
                  }}
                >
                  <span className={styles.cardTitle}>{ex.label}</span>
                  <span className={styles.cardMeta}>{strings.examplesGroup}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {band && (
        <div
          className={styles.band}
          style={{
            left: band.left,
            top: band.top,
            width: band.right - band.left,
            height: band.bottom - band.top,
          }}
        />
      )}

      {selected.size > 0 && (
        <div className={styles.actionBar} role="toolbar">
          <span className={styles.count}>{strings.librarySelected(selected.size)}</span>
          <button
            type="button"
            onClick={() => {
              const ids = [...selected];
              // Sharing is per notebook: one link, one notebook, one set of
              // people. A bulk share would have to invent what that means.
              if (ids.length !== 1) {
                void alertDialog(strings.shareOne);
                return;
              }
              void useShareStore.getState().openFor(ids[0]!);
            }}
            disabled={busy}
          >
            {strings.shareMenu}
          </button>
          <button type="button" onClick={() => void handleExport()} disabled={busy}>
            {strings.exportSession}
          </button>
          <button type="button" onClick={() => void handleDelete()} disabled={busy}>
            {strings.deleteNode}
          </button>
          <button type="button" onClick={() => useLibraryStore.getState().clearSelection()}>
            {strings.dismiss}
          </button>
        </div>
      )}
    </div>
  );
}
