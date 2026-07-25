import { createPortal } from 'react-dom';
import { useGoalStore } from '../store/goalStore';
import { acceptPlan } from '../services/goal';
import { useStrings } from '../i18n';
import styles from './GoalReview.module.css';

// The review step CLAUDE.md requires between "Claude proposes a decomposition"
// and "the graph changes". Shows every variable and every formula in full: the
// formulas are the model's actual reasoning, and they are what the learner is
// being asked to agree with.
export function GoalReview() {
  const strings = useStrings();
  const busy = useGoalStore((s) => s.busy);
  const plan = useGoalStore((s) => s.proposal);
  const error = useGoalStore((s) => s.error);
  const dismiss = useGoalStore((s) => s.dismiss);

  if (!busy && !plan && error === null) return null;

  const body = busy ? (
    <p className={styles.thinking}>{strings.goalThinking}</p>
  ) : error !== null ? (
    <>
      <div className={styles.errorTitle}>{strings.planFailed}</div>
      <code className={styles.errorDetail}>{error}</code>
    </>
  ) : plan ? (
    <>
      <p className={styles.intro}>{strings.planIntro}</p>

      <div className={styles.sectionLabel}>{strings.planVariables}</div>
      <table className={styles.table}>
        <tbody>
          {plan.variables.map((v) => (
            <tr key={v.name}>
              <td className={styles.label}>{v.label}</td>
              <td className={styles.value}>
                {v.value} <span className={styles.unit}>{v.unit}</span>
              </td>
              <td className={styles.name}>{v.name}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={styles.sectionLabel}>{strings.planDerived}</div>
      <table className={styles.table}>
        <tbody>
          {plan.derived
            .filter((d) => d.name !== plan.goalOf)
            .map((d) => (
              <tr key={d.name}>
                <td className={styles.label}>{d.label}</td>
                <td colSpan={2}>
                  <code className={styles.formula}>{d.formula}</code>
                </td>
              </tr>
            ))}
        </tbody>
      </table>

      <div className={styles.sectionLabel}>{strings.planGoal}</div>
      <div className={styles.goal}>
        <div className={styles.goalLabel}>{plan.goalLabel}</div>
        <code className={styles.formula}>
          {plan.derived.find((d) => d.name === plan.goalOf)?.formula}
        </code>
        {plan.goalNote && <div className={styles.goalNote}>{plan.goalNote}</div>}
      </div>
    </>
  ) : null;

  return createPortal(
    <div className={styles.backdrop} onMouseDown={busy ? undefined : dismiss}>
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={styles.title}>{plan ? plan.title : strings.planTitle}</div>
        <div className={styles.scroll}>{body}</div>
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={dismiss} disabled={busy}>
            {strings.dialogCancel}
          </button>
          {plan && (
            <button type="button" className={styles.primary} onClick={() => void acceptPlan(plan)}>
              {strings.planInsert}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
