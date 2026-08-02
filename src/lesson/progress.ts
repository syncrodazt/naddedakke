import type { LessonStep, RNode } from '../model/types';

// Reading progress off the graph rather than storing it.
//
// A counter would drift: chunks can be deleted, and a prerequisite can be
// spliced in mid-spine. The chunks themselves carry which plan step they teach,
// so the canvas is always the answer.

export type PlanRow = LessonStep & {
  /** 0-based position in the plan. */
  index: number;
  taught: boolean;
};

export function planRows(outline: LessonStep[], nodes: Record<string, RNode>): PlanRow[] {
  const taught = new Set<number>();
  for (const n of Object.values(nodes)) {
    if (n.kind === 'chunk' && n.planStep !== undefined) taught.add(n.planStep);
  }
  return outline.map((step, index) => ({ ...step, index, taught: taught.has(index) }));
}

/**
 * The chunk that teaches a plan step, if it exists.
 *
 * The earliest one, by seq: a step regenerated or taught twice should take you
 * to where it first entered the record, which is where its branches hang.
 */
export function chunkForStep(nodes: Record<string, RNode>, index: number): string | null {
  const matches = Object.values(nodes)
    .filter((n) => n.kind === 'chunk' && n.planStep === index)
    .sort((a, b) => a.seq - b.seq);
  return matches[0]?.id ?? null;
}
