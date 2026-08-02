import { useMemo } from 'react';
import { useGraphStore } from '../store/graphStore';
import { useLlmStore } from '../store/llmStore';
import { useCameraNav } from '../canvas/useCameraNav';
import { useStrings } from '../i18n';
import { nextLessonChunk, teachRemainingSteps } from '../services/lesson';
import { chunkForStep, planRows } from './progress';
import { usePlanStore } from './planStore';
import styles from './PlanPanel.module.css';

/**
 * The lesson's plan, shown in full from the start.
 *
 * Before this, the only way to find out what a lesson contained was to press
 * Next until it ran out: you could not tell whether you were three steps from
 * the point or thirty, so every step was an act of faith and there was no way
 * to judge the route before walking it. The whole plan is written first now, in
 * one call, and this is where you read it.
 *
 * Titles and one-line gists, not the teaching — showing the map is not the same
 * as dumping the lesson. And the choice of how to walk it is the learner's:
 * step by step, which is the pedagogy, or all at once, which is what you want
 * when you would rather read the thing whole.
 */
export function PlanPanel() {
  const strings = useStrings();
  const outline = useGraphStore((s) => s.session?.outline);
  const nodes = useGraphStore((s) => s.nodes);
  const streaming = useGraphStore((s) => s.streamingNodeId !== null);
  const lessonComplete = useGraphStore((s) => s.lessonComplete);
  const { planning, run, hide, cancelRun } = usePlanStore();
  const { zoomToNode } = useCameraNav();

  const rows = useMemo(() => planRows(outline ?? [], nodes), [outline, nodes]);
  const taught = rows.filter((r) => r.taught).length;
  const busy = streaming || run !== null;

  if (!outline || outline.length === 0) return null;

  return (
    <aside className={styles.panel} aria-label={strings.lessonPlanTitle}>
      <header className={styles.head}>
        <span className={styles.title}>{strings.lessonPlanTitle}</span>
        <button
          type="button"
          className={styles.close}
          onClick={hide}
          title={strings.lessonPlanHide}
        >
          ✕
        </button>
      </header>

      <div className={styles.summary}>
        {/* The count is the answer to "how long is this?", which is the whole
            reason the panel exists — so it leads. */}
        <span className={styles.counter}>
          {taught}/{rows.length}
        </span>
        <span className={styles.summaryText}>
          {planning ? strings.lessonPlanning : strings.lessonPlanSteps(rows.length)}
        </span>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.stepBtn}
          disabled={busy || lessonComplete || taught >= rows.length}
          onClick={() => void nextLessonChunk()}
        >
          {strings.lessonPlanNext}
        </button>
        {run ? (
          <button type="button" className={styles.cancelBtn} onClick={cancelRun}>
            {strings.lessonPlanStop} {run.done + 1}/{run.total}
          </button>
        ) : (
          <button
            type="button"
            className={styles.allBtn}
            disabled={busy || lessonComplete || taught >= rows.length}
            onClick={() => void teachRemainingSteps()}
          >
            {strings.lessonPlanAll}
          </button>
        )}
      </div>

      <ol className={styles.list}>
        {rows.map((row) => (
          <li key={row.index}>
            <button
              type="button"
              className={row.taught ? styles.row : styles.rowPending}
              data-current={row.index === run?.done || undefined}
              // Only a taught step has somewhere to go. A pending row is still
              // readable — that is the point — it just is not a link yet.
              disabled={!row.taught}
              onClick={() => {
                const id = chunkForStep(nodes, row.index);
                if (id) zoomToNode(id);
              }}
            >
              <span className={styles.num}>{row.taught ? '✓' : row.index + 1}</span>
              <span className={styles.body}>
                <span className={styles.stepTitle}>{row.title}</span>
                {row.gist !== '' && <span className={styles.gist}>{row.gist}</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>

      {busy && (
        <button
          type="button"
          className={styles.abort}
          onClick={() => {
            cancelRun();
            useLlmStore.getState().cancel();
          }}
        >
          {strings.stopStream}
        </button>
      )}
    </aside>
  );
}
