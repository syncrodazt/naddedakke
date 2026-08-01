import { useEffect, useMemo, useState } from 'react';
import { db } from '../db/db';
import { useStrings } from '../i18n';
import { useLibraryStore } from '../library/libraryStore';
import { useGraphStore } from '../store/graphStore';
import { startLesson } from '../services/lesson';
import { useConceptStore, rankedFrom, staleTitles } from './conceptStore';
import type { RankedConcept } from './types';
import { ConceptTree } from './ConceptTree';
import styles from './NextUp.module.css';

/** How many ready suggestions to put above the fold. */
const TOP = 10;

/**
 * "What should I learn next?"
 *
 * A ranked list, not a graph. The list is the product — if the suggestions are
 * wrong, no amount of layout saves them, and if they are right, a list is
 * already enough to act on. The graph comes later, as the illustration.
 *
 * Every row says what it connects to and what it opens up, because a
 * recommendation a machine wrote is one the learner should be able to judge
 * rather than merely obey.
 */
export function NextUp() {
  const strings = useStrings();
  const map = useConceptStore((s) => s.map);
  const loading = useConceptStore((s) => s.loading);
  const busy = useConceptStore((s) => s.busy);
  const error = useConceptStore((s) => s.error);
  const state = useConceptStore();
  // Two ways to read the same ranking. The list answers "what next"; the tree
  // answers "and what does that lead to".
  const [mode, setMode] = useState<'list' | 'tree'>('list');

  useEffect(() => {
    void useConceptStore.getState().load();
  }, []);

  const ranked = useMemo(() => rankedFrom(state), [state]);
  const stale = useMemo(() => staleTitles(state), [state]);

  const ready = ranked.filter((r) => r.ready).slice(0, TOP);
  const later = ranked.filter((r) => !r.ready);

  async function open(item: RankedConcept) {
    // Already has a notebook: continue it rather than starting a duplicate.
    const existing = item.concept.sessionIds[0];
    if (existing !== undefined && (await db.sessions.get(existing))) {
      await useGraphStore.getState().loadSession(existing);
      useLibraryStore.getState().show('canvas');
      return;
    }
    useLibraryStore.getState().show('canvas');
    await startLesson(item.concept.name);
  }

  const tree = map !== null && mode === 'tree';

  return (
    // The tree fills the window rather than sitting in a box on a scrolling
    // page: a graph you have to scroll the page to see is a graph you cannot
    // read, and the surrounding prose is guidance for the list anyway.
    <div className={tree ? styles.screenTree : styles.screen}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{strings.nextUpTitle}</h1>
          {!tree && <p className={styles.sub}>{strings.nextUpIntro}</p>}
        </div>
        <div className={styles.headActions}>
          {map && (
            <span className={styles.segmented}>
              <button
                type="button"
                className={mode === 'list' ? styles.segOn : styles.seg}
                onClick={() => setMode('list')}
              >
                {strings.conceptViewList}
              </button>
              <button
                type="button"
                className={mode === 'tree' ? styles.segOn : styles.seg}
                onClick={() => setMode('tree')}
              >
                {strings.conceptViewTree}
              </button>
            </span>
          )}
          <button
            type="button"
            className={styles.back}
            onClick={() => useLibraryStore.getState().show('library')}
          >
            {strings.libraryBack}
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={busy}
            onClick={() => void useConceptStore.getState().generate()}
          >
            {busy ? strings.nextUpThinking : map ? strings.nextUpRegenerate : strings.nextUpBuild}
          </button>
        </div>
      </header>

      {error !== null && (
        <p className={styles.warn} role="alert">
          {strings.nextUpFailed}: {error}
        </p>
      )}

      {!loading && !map && !busy && <p className={styles.empty}>{strings.nextUpEmpty}</p>}

      {!tree && map && stale.length > 0 && (
        <p className={styles.note}>
          {strings.nextUpStale(stale.length)} — {stale.slice(0, 3).join(', ')}
        </p>
      )}

      {tree && map && (
        <ConceptTree
          map={map}
          ranked={ranked}
          hint={strings.conceptTreeHint}
          onOpen={(item) => void open(item)}
        />
      )}

      {mode === 'list' && ready.length > 0 && (
        <section>
          <h2 className={styles.groupHeading}>{strings.nextUpReady}</h2>
          <ol className={styles.list}>
            {ready.map((item, i) => (
              <Row key={item.concept.id} item={item} rank={i + 1} onOpen={open} />
            ))}
          </ol>
        </section>
      )}

      {mode === 'list' && later.length > 0 && (
        <section>
          <h2 className={styles.groupHeading}>{strings.nextUpLater}</h2>
          <ol className={styles.list}>
            {later.map((item) => (
              <Row key={item.concept.id} item={item} onOpen={open} />
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function Row({
  item,
  rank,
  onOpen,
}: {
  item: RankedConcept;
  rank?: number;
  onOpen: (item: RankedConcept) => Promise<void>;
}) {
  const strings = useStrings();
  const { concept } = item;
  return (
    <li className={item.ready ? styles.card : styles.cardBlocked}>
      <div className={styles.rowHead}>
        {rank !== undefined && <span className={styles.rank}>{rank}</span>}
        <span className={styles.name}>{concept.name}</span>
        {item.status === 'met' && <span className={styles.tagMet}>{strings.nextUpStarted}</span>}
        {item.unlocks > 0 && (
          <span className={styles.tagUnlocks} title={strings.nextUpUnlocksTitle}>
            {strings.nextUpUnlocks(item.unlocks)}
          </span>
        )}
        <button
          type="button"
          className={styles.open}
          onClick={() => void onOpen(item)}
          disabled={!item.ready}
        >
          {item.status === 'met' ? strings.nextUpContinue : strings.nextUpStart}
        </button>
      </div>
      {concept.blurb !== '' && <p className={styles.blurb}>{concept.blurb}</p>}
      {concept.why !== undefined && <p className={styles.why}>↳ {concept.why}</p>}
      {!item.ready && (
        <p className={styles.missing}>
          {strings.nextUpNeedsFirst}: {item.missing.join(', ')}
        </p>
      )}
    </li>
  );
}
