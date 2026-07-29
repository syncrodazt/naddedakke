import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useReactFlow } from '@xyflow/react';
import type { Session } from '../model/types';
import { db } from '../db/db';
import { examples } from '../fixture/examples';
import { useGraphStore } from '../store/graphStore';
import { useRevealStore } from '../replay/revealStore';
import { usePanelStore } from '../store/panelStore';
import { useAuthStore } from '../store/authStore';
import { useStrings } from '../i18n';
import styles from './CommandPalette.module.css';

type Entry = { id: string; title: string; kind: 'session' | 'example' };

/**
 * Ctrl/⌘+K — switch notebook.
 *
 * The toolbar's dropdown truncated every title to fit a crowded strip, so the
 * one thing you needed to tell notebooks apart was the thing you could not
 * read. Here each name gets a full line.
 */
export function CommandPalette() {
  const strings = useStrings();
  const open = usePanelStore((s) => s.panel === 'palette');
  const close = usePanelStore((s) => s.close);
  const syncNonce = useAuthStore((s) => s.syncNonce);
  const sessionsRevision = useGraphStore((s) => s.sessionsRevision);
  const currentId = useGraphStore((s) => s.session?.id);
  const { fitView } = useReactFlow();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    void db.sessions
      .orderBy('createdAt')
      .toArray()
      .then((rows) => setSessions(rows.reverse())); // most recent first
  }, [open, syncNonce, sessionsRevision]);

  const entries = useMemo<Entry[]>(() => {
    const saved: Entry[] = sessions.map((s) => ({
      id: s.id,
      title: s.title || s.id,
      kind: 'session',
    }));
    const unloaded: Entry[] = examples
      .filter((ex) => !sessions.some((s) => s.id === ex.id))
      .map((ex) => ({ id: ex.id, title: ex.label, kind: 'example' }));
    const needle = query.trim().toLowerCase();
    const all = [...saved, ...unloaded];
    return needle === '' ? all : all.filter((e) => e.title.toLowerCase().includes(needle));
  }, [sessions, query]);

  if (!open) return null;

  async function choose(entry: Entry) {
    close();
    useRevealStore.getState().showAll();
    if (entry.kind === 'session') {
      await useGraphStore.getState().loadSession(entry.id);
    } else {
      const example = examples.find((ex) => ex.id === entry.id);
      if (example) await useGraphStore.getState().applyImport(example.data);
    }
    void fitView({ duration: 500 });
  }

  return createPortal(
    <div className={styles.backdrop} onMouseDown={close}>
      <div className={styles.card} onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          autoFocus
          className={styles.search}
          placeholder={strings.palettePlaceholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Reset the highlight with the keystroke that caused it, rather
            // than in an effect reacting to the new query.
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, entries.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === 'Enter') {
              const entry = entries[cursor];
              if (entry) void choose(entry);
            }
          }}
        />
        <div className={styles.list} role="listbox">
          {entries.length === 0 && <p className={styles.empty}>{strings.paletteEmpty}</p>}
          {entries.map((entry, i) => (
            <button
              key={`${entry.kind}:${entry.id}`}
              type="button"
              role="option"
              aria-selected={i === cursor}
              className={i === cursor ? styles.rowOn : styles.row}
              onMouseEnter={() => setCursor(i)}
              onClick={() => void choose(entry)}
            >
              <span className={styles.rowTitle}>{entry.title}</span>
              {entry.kind === 'example' && (
                <span className={styles.tag}>{strings.examplesGroup}</span>
              )}
              {entry.id === currentId && <span className={styles.current}>●</span>}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
