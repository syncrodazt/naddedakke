import { evaluate } from 'mathjs';
import type { REdge, RNode } from '../model/types';

// Gyakusan dataflow: variable nodes hold values, derived/goal nodes hold
// mathjs formulas referencing other node ids by name, wired by `depends`
// edges. Recompute walks the graph in topological order; cycles are rejected
// with a per-node issue (visible badge in the UI) instead of crashing.

export type ComputeResult = {
  /** New values for every formula node that evaluated successfully. */
  values: Record<string, number>;
  /** nodeId → human-readable issue (cycle or evaluation error). */
  issues: Record<string, string>;
};

export const CYCLE_ISSUE = 'cycle';

export function recomputeGraph(
  nodes: Record<string, RNode>,
  edges: Record<string, REdge>,
): ComputeResult {
  const values: Record<string, number> = {};
  const issues: Record<string, string> = {};

  // Seed the scope with all input (non-formula) node values.
  for (const node of Object.values(nodes)) {
    if (node.formula === undefined && node.value !== undefined) {
      values[node.id] = node.value;
    }
  }

  const formulaNodes = Object.values(nodes).filter((n) => n.formula !== undefined);
  const formulaIds = new Set(formulaNodes.map((n) => n.id));
  const depends = Object.values(edges).filter((e) => e.kind === 'depends');

  // Kahn's algorithm over formula nodes only (variables have no in-edges that matter).
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const id of formulaIds) inDegree.set(id, 0);
  for (const e of depends) {
    if (!formulaIds.has(e.target)) continue;
    if (formulaIds.has(e.source)) {
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
      dependents.set(e.source, [...(dependents.get(e.source) ?? []), e.target]);
    }
  }

  const queue = [...formulaIds].filter((id) => (inDegree.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of dependents.get(id) ?? []) {
      const deg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }

  // Whatever never reached in-degree 0 sits on a cycle.
  for (const id of formulaIds) {
    if (!order.includes(id)) issues[id] = CYCLE_ISSUE;
  }

  for (const id of order) {
    const node = nodes[id]!;
    try {
      const result: unknown = evaluate(node.formula!, { ...values });
      if (typeof result !== 'number' || !Number.isFinite(result)) {
        throw new Error(`non-numeric result`);
      }
      values[id] = result;
    } catch (err) {
      issues[id] = err instanceof Error ? err.message : String(err);
    }
  }

  return { values, issues };
}
