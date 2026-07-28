import { useGraphStore } from '../store/graphStore';
import { useGoalStore } from '../store/goalStore';
import { isAbort, useLlmStore } from '../store/llmStore';
import { getStrings } from '../i18n';
import { PlanError, parseGoalPlan, planToSession, type GoalPlan } from '../gyakusan/plan';
import { namesInUse } from '../gyakusan/subplan';
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

/**
 * Back-cast one node that is already on the canvas: "what does this depend on?"
 *
 * This is the mirror of なんで？. Where a why-branch hangs a question downstream
 * off a highlighted phrase, this generates the quantities UPSTREAM of a node —
 * the inputs it follows from — and gives the node the formula that ties them
 * together. Like every decomposition it is proposed, not inserted.
 */
export async function decomposeNode(nodeId: string): Promise<void> {
  const { nodes, session } = useGraphStore.getState();
  const node = nodes[nodeId];
  if (!node || !session) return;

  const goalStore = useGoalStore.getState();
  const llm = useLlmStore.getState();
  goalStore.setBusy(true);

  // Everything already on the canvas may be referenced but not redefined.
  const existingNames = [...namesInUse(nodes).keys()];
  const label = node.content.md
    .replace(/[*_`>#]/g, '')
    .trim()
    .slice(0, 200);
  const req: GoalPlanRequest = {
    goal:
      `Decompose this ONE quantity into what it depends on: "${label}".\n` +
      `Notebook: "${session.title}".\n` +
      'Set "goalOf" to the quantity that represents it.',
    existingNames,
    signal: llm.begin(),
  };

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
    useGoalStore.getState().propose(parseGoalPlan(raw, new Set(existingNames)), nodeId);
  } catch (err) {
    const detail = err instanceof PlanError ? err.message : String(err);
    useGoalStore.getState().setError(detail);
  }
}

/**
 * Accept a reviewed plan. A plan with a target node is inserted into the open
 * notebook around that node; one without starts a fresh gyakusan session.
 */
export async function acceptPlan(plan: GoalPlan): Promise<void> {
  const targetNodeId = useGoalStore.getState().targetNodeId;
  if (targetNodeId !== null) {
    useGraphStore.getState().insertSubPlan(targetNodeId, plan);
    useGoalStore.getState().dismiss();
    return;
  }
  // With a notebook open, the plan joins it — a back-cast is a way of thinking
  // about what you are already working on, not a separate kind of document.
  // Only with nothing open does it become a notebook of its own.
  if (useGraphStore.getState().session) {
    useGraphStore.getState().insertGoalPlan(plan);
    useGoalStore.getState().dismiss();
    return;
  }
  const payload = planToSession(plan, getStrings().gyakusanDisclaimer);
  await useGraphStore.getState().applyImport(payload);
  useGoalStore.getState().dismiss();
}
