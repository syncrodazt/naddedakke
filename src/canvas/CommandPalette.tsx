import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useReactFlow } from '@xyflow/react';
import type { Session } from '../model/types';
import { db } from '../db/db';
import { examples } from '../fixture/examples';
import { useGraphStore } from '../store/graphStore';
import { useLibraryStore } from '../library/libraryStore';
import { useRevealStore } from '../replay/revealStore';
import { usePanelStore } from '../store/panelStore';
import { useAuthStore } from '../store/authStore';
import { useStrings, type TextKey } from '../i18n';
import { startLesson } from '../services/lesson';
import { promptDialog } from '../store/uiStore';
import {
  MAX_DIGIT_ROWS,
  digitTarget,
  matchingCommands,
  type PaletteCommand,
} from './paletteCommands';
import { useReplayStore } from '../replay/replayStore';
import { useCameraNav } from './useCameraNav';
import styles from './CommandPalette.module.css';

type Entry =
  | { kind: 'session' | 'example'; id: string; title: string }
  // Actions, not notebooks: found by typing what you want to DO. Kept in the
  // same list because "new" is a thing you look for here, and a separate menu
  // for it would be one more place to remember.
  | { kind: 'command'; command: PaletteCommand }
  // Typing something no notebook matches is usually not a failed search — it
  // is the thing you want to learn. Offer it as the action rather than an
  // empty list.
  | { kind: 'ask'; topic: string };

const COMMAND_LABEL: Record<PaletteCommand, TextKey> = {
  new: 'paletteNew',
  replay: 'paletteReplay',
};
const COMMAND_HINT: Record<PaletteCommand, TextKey> = {
  new: 'paletteNewHint',
  replay: 'paletteReplayHint',
};
const COMMAND_ICON: Record<PaletteCommand, string> = { new: '＋', replay: '▶' };

/**
 * Ctrl/⌘+K — switch notebook.
 *
 * The toolbar's dropdown truncated every title to fit a crowded strip, so the
 * one thing you needed to tell notebooks apart was the thing you could not
 * read. Here each name gets a full line.
 *
 * Three ways to land on one, because they suit different moments: a digit when
 * you can see it in the list, arrows when you are browsing, and typing when you
 * know the name.
 */
export function CommandPalette() {
  const strings = useStrings();
  const open = usePanelStore((s) => s.panel === 'palette');
  const close = usePanelStore((s) => s.close);
  const syncNonce = useAuthStore((s) => s.syncNonce);
  const sessionsRevision = useGraphStore((s) => s.sessionsRevision);
  const currentId = useGraphStore((s) => s.session?.id);
  // Replay is only offered once there is something to replay. An action that
  // cannot run would still take the top row, which is where Enter lands.
  const hasNodes = useGraphStore((s) => Object.keys(s.nodes).length > 0);
  const { fitView } = useReactFlow();
  const { panToNode } = useCameraNav();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    void db.sessions
      .orderBy('createdAt')
      .toArray()
      .then((rows) => setSessions(rows.reverse())); // most recent first
  }, [open, syncNonce, sessionsRevision]);

  // Escape closes from anywhere, not only from the search box. Focus can end up
  // elsewhere — a click on a row, a browser restoring focus — and a dialog that
  // will not close on Escape is a trap.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    }
    // Capture, so this runs before the screen underneath sees the same Escape.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close]);

  // Keep the highlighted row on screen while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.children[cursor];
    if (row instanceof HTMLElement) row.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  const entries = useMemo<Entry[]>(() => {
    const saved: Entry[] = sessions.map((s) => ({
      id: s.id,
      title: s.title || s.id,
      kind: 'session',
    }));
    const unloaded: Entry[] = examples
      .filter((ex) => !sessions.some((s) => s.id === ex.id))
      .map((ex) => ({ id: ex.id, title: ex.label, kind: 'example' }));
    const topic = query.trim();
    const needle = topic.toLowerCase();
    if (needle === '') return [...saved, ...unloaded];

    const matches = [...saved, ...unloaded].filter((e) =>
      'title' in e ? e.title.toLowerCase().includes(needle) : false,
    );
    // Actions lead: someone who typed "new" wants to create, not to find a
    // notebook that happens to have "new" in its name.
    const available: PaletteCommand[] = hasNodes ? ['new', 'replay'] : ['new'];
    const commands: Entry[] = matchingCommands(needle, available).map((command) => ({
      kind: 'command',
      command,
    }));
    // The ask row goes last, so Enter on a typed word still opens the notebook
    // that matches it; you have to arrow down to start something new.
    return [...commands, ...matches, { kind: 'ask' as const, topic }];
  }, [sessions, query, hasNodes]);

  if (!open) return null;

  async function choose(entry: Entry) {
    close();
    useRevealStore.getState().showAll();
    // Whatever you picked, the replay you were watching is over — its cursor
    // counts nodes of the notebook it started in.
    useReplayStore.getState().exit();
    // Picking anything here means "take me to it", and it lives on the canvas.
    // Opening a notebook while leaving the library up would look like nothing
    // happened.
    useLibraryStore.getState().show('canvas');
    if (entry.kind === 'command') {
      if (entry.command === 'replay') {
        useReplayStore.getState().start();
        return;
      }
      const topic = (await promptDialog(strings.topicPrompt, '', strings.topicPlaceholder))?.trim();
      if (!topic) return;
      const chunkId = await startLesson(topic);
      panToNode(chunkId);
      return;
    }
    if (entry.kind === 'ask') {
      const chunkId = await startLesson(entry.topic);
      panToNode(chunkId);
      return;
    }
    if (entry.kind === 'session') {
      await useGraphStore.getState().loadSession(entry.id);
    } else {
      const example = examples.find((ex) => ex.id === entry.id);
      if (example) await useGraphStore.getState().applyImport(example.data);
    }
    void fitView({ duration: 500 });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, entries.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      const entry = entries[cursor];
      if (entry) void choose(entry);
      return;
    }
    const target = digitTarget(e.key, query, entries.length);
    if (target !== null) {
      e.preventDefault();
      const entry = entries[target];
      if (entry) void choose(entry);
    }
    // Escape is handled by the window listener above, so it works wherever
    // focus happens to be.
  }

  // Digits only act while the box is empty, so the badges appear exactly when
  // pressing them would do something.
  const showDigits = query.trim() === '';

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
          onKeyDown={onKeyDown}
        />
        <div className={styles.list} role="listbox" ref={listRef}>
          {entries.length === 0 && <p className={styles.empty}>{strings.paletteEmpty}</p>}
          {entries.map((entry, i) => (
            <button
              key={
                entry.kind === 'ask'
                  ? 'ask'
                  : entry.kind === 'command'
                    ? `command:${entry.command}`
                    : `${entry.kind}:${entry.id}`
              }
              type="button"
              role="option"
              aria-selected={i === cursor}
              aria-keyshortcuts={showDigits && i < MAX_DIGIT_ROWS ? String(i + 1) : undefined}
              className={i === cursor ? styles.rowOn : styles.row}
              onMouseEnter={() => setCursor(i)}
              onClick={() => void choose(entry)}
            >
              {showDigits && i < MAX_DIGIT_ROWS ? (
                <span className={styles.digit}>{i + 1}</span>
              ) : (
                entry.kind !== 'ask' &&
                entry.kind !== 'command' && <span className={styles.digitGap} />
              )}
              {entry.kind === 'command' ? (
                <>
                  <span className={styles.ask}>{COMMAND_ICON[entry.command]}</span>
                  <span className={styles.rowTitle}>{strings[COMMAND_LABEL[entry.command]]}</span>
                  <span className={styles.tag}>{strings[COMMAND_HINT[entry.command]]}</span>
                </>
              ) : entry.kind === 'ask' ? (
                <>
                  <span className={styles.ask}>＋</span>
                  <span className={styles.rowTitle}>
                    {strings.paletteAsk} 「{entry.topic}」
                  </span>
                </>
              ) : (
                <>
                  <span className={styles.rowTitle}>{entry.title}</span>
                  {entry.kind === 'example' && (
                    <span className={styles.tag}>{strings.examplesGroup}</span>
                  )}
                  {entry.id === currentId && <span className={styles.current}>●</span>}
                </>
              )}
            </button>
          ))}
        </div>
        <p className={styles.hint}>{strings.paletteHint}</p>
      </div>
    </div>,
    document.body,
  );
}
