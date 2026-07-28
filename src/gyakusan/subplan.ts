import type { REdge, RNode } from '../model/types';
import { newId } from '../model/ids';
import { NODE_W, SPINE_GAP_X } from '../layout/layout';
import { formulaSymbols, type GoalPlan } from './plan';

// Inserting a decomposition of ONE node into a graph that already exists.
//
// `planToSession` builds a whole new session from a plan; this is the other
// half of back-casting — pointing at a quantity already on the canvas and
// asking what it depends on. The plan's `goalOf` is not a new goal node here:
// its formula lands on the node the learner pointed at, and the plan's other
// quantities become that node's inputs.

const ROW_GAP_Y = 180;

export type SubPlanResult = {
  /** Nodes to add, plus the target with its new formula. */
  nodes: RNode[];
  edges: REdge[];
  /** Ids of the newly created input nodes, for the camera. */
  createdIds: string[];
};

/** varName → node, for every node that participates in formulas. */
export function namesInUse(nodes: Record<string, RNode>): Map<string, RNode> {
  const map = new Map<string, RNode>();
  for (const node of Object.values(nodes)) {
    const name =
      node.varName ??
      (node.formula !== undefined || node.value !== undefined ? node.id : undefined);
    if (name !== undefined) map.set(name, node);
  }
  return map;
}

/**
 * Turn a plan into additions around `targetId`.
 *
 * `nextSeq` is called once per new node so the caller keeps ownership of the
 * chronological counter — seq must come from the session, never be invented here.
 */
export function applySubPlan(
  nodes: Record<string, RNode>,
  targetId: string,
  plan: GoalPlan,
  sessionId: string,
  nextSeq: () => number,
): SubPlanResult {
  const target = nodes[targetId];
  if (!target) throw new Error(`unknown node ${targetId}`);

  const existing = namesInUse(nodes);
  // Names the plan defines; anything else a formula reads must already exist.
  const idOf = new Map<string, string>();
  for (const [name, node] of existing) idOf.set(name, node.id);

  const added: RNode[] = [];
  const edges: REdge[] = [];
  const createdIds: string[] = [];

  // Upstream reads left-to-right like the rest of the app: inputs sit to the
  // left of the thing they feed.
  const baseX = target.position.x - (NODE_W + SPINE_GAP_X);
  let row = 0;
  const place = () => ({
    x: baseX,
    y:
      target.position.y +
      (row++ - (plan.variables.length + plan.derived.length - 2) / 2) * ROW_GAP_Y,
  });

  for (const v of plan.variables) {
    if (existing.has(v.name)) continue; // reuse a quantity already on the canvas
    const id = newId();
    idOf.set(v.name, id);
    createdIds.push(id);
    added.push({
      id,
      sessionId,
      kind: 'variable',
      seq: nextSeq(),
      varName: v.name,
      position: place(),
      content: { md: `**${v.label}**`, highlights: [] },
      value: v.value,
      unit: v.unit,
      varInput: { min: v.min, max: v.max, step: v.step },
    });
  }

  for (const d of plan.derived) {
    if (d.name === plan.goalOf) continue; // that formula lands on the target
    if (existing.has(d.name)) continue;
    const id = newId();
    idOf.set(d.name, id);
    createdIds.push(id);
    added.push({
      id,
      sessionId,
      kind: 'derived',
      seq: nextSeq(),
      varName: d.name,
      position: place(),
      content: { md: `**${d.label}**${d.note ? `\n\n${d.note}` : ''}`, highlights: [] },
      formula: d.formula,
      unit: d.unit,
    });
  }

  // The target keeps its own text and identity; it gains the formula that says
  // how it follows from its new inputs.
  const goalDerived = plan.derived.find((d) => d.name === plan.goalOf);
  const updatedTarget: RNode = {
    ...target,
    // A node that now computes is no longer an input the learner can drag.
    kind: target.kind === 'goal' ? 'goal' : 'derived',
    varName: target.varName ?? plan.goalOf,
    formula: goalDerived?.formula ?? target.formula,
    unit:
      goalDerived?.unit !== undefined && goalDerived.unit !== '' ? goalDerived.unit : target.unit,
  };
  // Dragging a slider on a node whose value is now computed would be a lie.
  delete (updatedTarget as { varInput?: unknown }).varInput;
  idOf.set(updatedTarget.varName!, targetId);

  // Wire dependencies from what each formula actually reads, exactly as
  // planToSession does — never from a list the model was asked to keep in sync.
  const withFormula = [...added.filter((n) => n.formula !== undefined), updatedTarget];
  for (const node of withFormula) {
    for (const symbol of formulaSymbols(node.formula!, `node "${node.varName ?? node.id}"`)) {
      const sourceId = idOf.get(symbol);
      if (sourceId === undefined || sourceId === node.id) continue;
      edges.push({ id: newId(), sessionId, kind: 'depends', source: sourceId, target: node.id });
    }
  }

  return { nodes: [...added, updatedTarget], edges, createdIds };
}
