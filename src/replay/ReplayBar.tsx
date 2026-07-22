import { useEffect, useMemo } from 'react';
import { useGraphStore } from '../store/graphStore';
import { useCameraNav } from '../canvas/useCameraNav';
import { strings } from '../strings';
import { BEAT_MS, useReplayStore, type ReplaySpeed } from './replayStore';
import { sortedBySeq } from './visibility';
import styles from './ReplayBar.module.css';

const SPEEDS: ReplaySpeed[] = [0.5, 1, 2];

export function ReplayBar() {
  const { playing, cursor, speed, exit, setPlaying, setCursor, setSpeed } = useReplayStore();
  const nodes = useGraphStore((s) => s.nodes);
  const { panToNode } = useCameraNav();

  const ordered = useMemo(() => sortedBySeq(nodes), [nodes]);
  const total = ordered.length;

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

  // Camera follows the newest revealed node — both on beats and on scrubbing.
  useEffect(() => {
    const newest = ordered[cursor - 1];
    if (newest) panToNode(newest.id);
  }, [cursor, ordered, panToNode]);

  // Esc exits replay.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') exit();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exit]);

  const finished = cursor >= total;

  return (
    <div className={styles.bar}>
      <button
        type="button"
        className={styles.play}
        onClick={() => {
          if (finished) {
            useReplayStore.setState({ cursor: 1, playing: true });
          } else {
            setPlaying(!playing);
          }
        }}
        aria-label={playing ? strings.replayPause : strings.replayPlay}
      >
        {playing ? '⏸' : finished ? '↺' : '▶'}
      </button>
      <input
        className={styles.scrubber}
        type="range"
        min={0}
        max={total}
        step={1}
        value={cursor}
        onChange={(e) => setCursor(Number(e.target.value))}
      />
      <span className={styles.counter}>
        {cursor}/{total}
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
      <button type="button" className={styles.exit} onClick={exit}>
        {strings.replayExit}
      </button>
    </div>
  );
}
