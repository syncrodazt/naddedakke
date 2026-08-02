import type { LessonStep, RNode } from '../model/types';
import { salvageArrayObjects, stripFence } from './jsonSalvage';

// Parsing and using the plan a lesson is taught against.
//
// The plan exists because a lesson delivered one card at a time is unreadable
// as an argument: you cannot tell whether you are three steps from the point or
// thirty, and every "next" is a small act of faith. Writing the whole plan first
// and showing it costs one call and answers that permanently — and it does not
// dump the lesson, because a title and a one-line gist are not the teaching.

export class LessonPlanError extends Error {}

/** Enough to build an understanding; more is a syllabus, not a lesson. */
export const MAX_STEPS = 16;
export const MIN_STEPS = 3;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function toStep(v: unknown): LessonStep | null {
  if (!isRecord(v)) return null;
  const title = typeof v.title === 'string' ? v.title.trim() : '';
  if (title === '') return null;
  const gist = typeof v.gist === 'string' ? v.gist.trim() : '';
  return { title, gist };
}

/**
 * The steps of a proposed plan, or a failure that says what actually came back.
 *
 * A step with no title is dropped rather than shown as a blank row: the whole
 * value of the list is that you can read it. A reply that ran out of budget is
 * salvaged the same way a concept map is — nine steps that arrived intact beat
 * an error message.
 */
export function parsePlan(raw: string): LessonStep[] {
  let entries: unknown[];
  try {
    const parsed: unknown = JSON.parse(stripFence(raw));
    if (!isRecord(parsed) || !Array.isArray(parsed.steps)) {
      throw new LessonPlanError('reply has no "steps" array');
    }
    entries = parsed.steps;
  } catch (err) {
    if (err instanceof LessonPlanError) throw err;
    entries = salvageArrayObjects(raw, 'steps');
  }

  const steps = entries
    .map(toStep)
    .filter((s): s is LessonStep => s !== null)
    .slice(0, MAX_STEPS);
  if (steps.length < MIN_STEPS) {
    const summary = raw.trim() === '' ? '(empty reply)' : raw.trim().slice(0, 160);
    throw new LessonPlanError(`plan had ${steps.length} usable steps: ${summary}`);
  }
  return steps;
}

/**
 * Which plan steps have actually been taught.
 *
 * Read off the chunks rather than counted, because a chunk can be spliced in
 * out of order (a prerequisite) or deleted, and a stored counter would drift
 * away from what is on the canvas.
 */
export function taughtSteps(nodes: Record<string, RNode>): Set<number> {
  const done = new Set<number>();
  for (const n of Object.values(nodes)) {
    if (n.kind === 'chunk' && n.planStep !== undefined) done.add(n.planStep);
  }
  return done;
}

/** The lowest plan step not yet taught, or null when the plan is finished. */
export function nextPlanStep(nodes: Record<string, RNode>, outline: LessonStep[]): number | null {
  const done = taughtSteps(nodes);
  for (let i = 0; i < outline.length; i++) if (!done.has(i)) return i;
  return null;
}
