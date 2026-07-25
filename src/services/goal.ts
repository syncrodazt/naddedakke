import { useGraphStore } from '../store/graphStore';
import { useGoalStore } from '../store/goalStore';
import { isAbort, useLlmStore } from '../store/llmStore';
import { getStrings } from '../i18n';
import { PlanError, parseGoalPlan, planToSession, type GoalPlan } from '../gyakusan/plan';
import { mockService, teachService } from './claude';
import type { GoalPlanRequest } from './claude/types';

/**
 * Ask the model to decompose a goal into a dependency graph. The result is only
 * *proposed* — it lands in the review dialog, not on the canvas.
 *
 * Unlike the lesson flows this does not silently fall back to mock output: a
 * fabricated financial model presented as the model's own analysis is exactly
 * the kind of thing the learner must be told about, so a fallback raises the
 * same notice the streaming paths use.
 */
export async function decomposeGoal(goal: string): Promise<void> {
  const goalStore = useGoalStore.getState();
  const llm = useLlmStore.getState();
  goalStore.setBusy(true);

  const req: GoalPlanRequest = { goal, signal: llm.begin() };
  let raw: string;
  try {
    raw = await teachService.decomposeGoal(req);
  } catch (err) {
    if (isAbort(err)) {
      useLlmStore.getState().end();
      useGoalStore.getState().dismiss();
      return;
    }
    llm.noteFallback(err);
    raw = await mockService.decomposeGoal(req);
  } finally {
    useLlmStore.getState().end();
  }

  try {
    useGoalStore.getState().propose(parseGoalPlan(raw));
  } catch (err) {
    // A malformed plan is the model's fault, not the learner's — say what was
    // wrong with it rather than showing a raw parse error.
    const detail = err instanceof PlanError ? err.message : String(err);
    useGoalStore.getState().setError(detail);
  }
}

/** Accept a reviewed plan: build a gyakusan session from it and open it. */
export async function acceptPlan(plan: GoalPlan): Promise<void> {
  const payload = planToSession(plan, getStrings().gyakusanDisclaimer);
  await useGraphStore.getState().applyImport(payload);
  useGoalStore.getState().dismiss();
}
