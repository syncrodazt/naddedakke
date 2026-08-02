import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { NodeKind } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { displayContent } from '../model/content';
import { headingOf } from '../markdown/heading';
import { useCameraNav } from '../canvas/useCameraNav';
import { isTyping } from '../canvas/isTyping';
import { useStrings, type TextKey } from '../i18n';
import { BEAT_MS, useReplayStore, type ReplaySpeed } from './replayStore';
import { timelineRows } from './timeline';
import styles from './ReplayPanel.module.css';

const SPEEDS: ReplaySpeed[] = [0.5, 1, 2];

const KIND_LABEL: Partial<Record<NodeKind, TextKey>> = {
  chunk: 'chunkLabel',
  question: 'questionLabel',
  answer: 'answerLabel',
  playground: 'playgroundLabel',
  goal: 'goalLabel',
  variable: 'variableLabel',
  derived: 'derivedLabel',
};

/**
 * The replay track list.
 *
 * It replaced a scrubber along the bottom, which was the wrong instrument: a
 * slider gives you a position but not a sequence, so you could see you were 3/12
 * of the way through without ever seeing what the twelve were. A list down the
 * side shows the whole run — how many steps, which are questions, where you are
 * — and stepping through it with the arrows is the same motion as reading.
 *
 * Unreached rows stay locked. Their number and shape are visible (the sequence
 * is the thing being learned, so it has to be there from the first beat) but
 * their titles are not, because knowing what step 9 answers before you get
 * there is exactly the spoiler that makes a replay pointless.
 */
export function ReplayPanel() {
  const strings = useStrings();
  const { playing, cursor, speed, exit, setPlaying, setCursor, setSpeed, step } = useReplayStore();
  const nodes = useGraphStore((s) => s.nodes);
  const contentLang = useGraphStore((s) => s.session?.contentLang);
  const { panToNode } = useCameraNav();
  const listRef = useRef<HTMLDivElement>(null);

  // Titles come from the body the learner is actually reading, translation and
  // all — the list has to match the cards.
  const rows = useMemo(
    () => timelineRows(nodes, cursor, (n) => headingOf(displayContent(n.content, contentLang).md)),
    [nodes, cursor, contentLang],
  );
  const total = rows.length;
  const finished = cursor >= total;
  const understood = rows.filter((r) => r.understood).length;

  const togglePlay = useCallback(() => {
    if (finished) useReplayStore.setState({ cursor: 1, playing: true });
    else setPlaying(!playing);
  }, [finished, playing, setPlaying]);

  // Auto-advance one node per beat while playing.
  useEffect(() => {
    if (!playing) return;
    if (cursor >= total) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => {
      useReplayStore.setState({ cursor: cursor + 1 });
    }, BEAT_MS / speed);
    return () => clearTimeout(t);
  }, [playing, cursor, total, speed, setPlaying]);

  // Camera follows the newest revealed node — on beats, arrows and clicks alike.
  useEffect(() => {
    const newest = rows[cursor - 1];
    if (newest) panToNode(newest.id);
  }, [cursor, rows, panToNode]);

  // Keep the row you are on in view without stealing the scrollbar from someone
  // reading ahead of it.
  useEffect(() => {
    const row = listRef.current?.querySelector('[data-current]');
    if (row instanceof HTMLElement) row.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  // The arrows drive replay while it is running — they are the whole point of a
  // track list. CanvasShortcuts stands down for the duration (it normally binds
  // them to moving focus between nodes).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        exit();
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        step(1, total);
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        step(-1, total);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exit, step, total, togglePlay]);

  return (
    <aside className={styles.panel} aria-label={strings.replay}>
      <header className={styles.head}>
        <span className={styles.title}>{strings.replay}</span>
        <button type="button" className={styles.exit} onClick={exit}>
          {strings.replayExit}
        </button>
      </header>

      <div className={styles.transport}>
        <button
          type="button"
          className={styles.play}
          onClick={togglePlay}
          aria-label={playing ? strings.replayPause : strings.replayPlay}
        >
          {playing ? '⏸' : finished ? '↺' : '▶'}
        </button>
        <span className={styles.counter}>
          {cursor}/{total}
        </span>
        <span className={styles.understood} title={strings.understoodTitle}>
          ✓ {understood}
        </span>
        <span className={styles.speeds}>
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              className={s === speed ? styles.speedActive : styles.speed}
              onClick={() => setSpeed(s)}
            >
              ×{s}
            </button>
          ))}
        </span>
      </div>

      <div className={styles.list} ref={listRef}>
        {rows.map((row) => {
          const labelKey = KIND_LABEL[row.kind];
          return (
            <button
              key={row.id}
              type="button"
              className={row.reached ? styles.row : styles.rowLocked}
              data-current={row.current || undefined}
              data-kind={row.kind}
              // A locked row is a place you have not been yet; jumping to it
              // would reveal the thing replay is holding back.
              disabled={!row.reached}
              title={row.reached ? (row.title ?? undefined) : strings.replayLocked}
              onClick={() => setCursor(row.rank)}
            >
              <span className={styles.rank}>{row.rank}</span>
              <span className={styles.rowBody}>
                <span className={styles.kind}>{labelKey ? strings[labelKey] : row.kind}</span>
                <span className={styles.rowTitle}>{row.title ?? '—'}</span>
              </span>
              {row.understood && <span className={styles.tick}>✓</span>}
            </button>
          );
        })}
      </div>

      <p className={styles.hint}>{strings.replayHint}</p>
    </aside>
  );
}
