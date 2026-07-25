import { parse } from 'mathjs';
import type { REdge, RNode, Session, SessionExport } from '../model/types';
import { newId } from '../model/ids';
import { computeLayout } from '../layout/layout';

// A back-cast plan proposed by the model: the variables a goal decomposes into,
// the intermediate quantities derived from them, and the goal itself.
//
// Everything here is untrusted LLM output, so it is parsed and checked before
// the learner is ever shown it, and shown before it is ever inserted. Formulas
// are evaluated by mathjs (no eval), but a formula referencing an unknown name
// or forming a cycle would still produce a broken graph, so both are rejected
// up front rather than left to surface as error badges.

export type PlanVariable = {
  name: string;
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
};

export type PlanDerived = {
  name: string;
  label: string;
  formula: string;
  unit: string;
  note?: string;
};

export type GoalPlan = {
  title: string;
  goalLabel: string;
  goalNote: string;
  variables: PlanVariable[];
  derived: PlanDerived[];
  /** Name of the derived quantity that answers the goal. */
  goalOf: string;
};

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class PlanError extends Error {}

function fail(message: string): never {
  throw new PlanError(message);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function str(v: unknown, where: string): string {
  if (typeof v !== 'string' || v.trim() === '') fail(`${where} must be a non-empty string`);
  return v.trim();
}

function num(v: unknown, where: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${where} must be a finite number`);
  return v;
}

/** Symbols a formula reads, via the mathjs parser (regex would trip on `max(` etc). */
export function formulaSymbols(formula: string, where: string): string[] {
  let tree;
  try {
    tree = parse(formula);
  } catch (err) {
    fail(`${where}: cannot parse "${formula}" (${err instanceof Error ? err.message : ''})`);
  }
  const found = new Set<string>();
  tree.traverse((node, _path, parent) => {
    // A SymbolNode in the function position of a call is a function name
    // (max, sqrt, …), not a value we need to wire a dependency to.
    if (node.type !== 'SymbolNode') return;
    if (parent?.type === 'FunctionNode' && (parent as { fn?: unknown }).fn === node) return;
    found.add((node as unknown as { name: string }).name);
  });
  return [...found];
}

/** The model sometimes wraps JSON in a ``` fence; take the outermost object. */
export function extractJson(raw: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const body = fenced?.[1] ?? raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) fail('the model did not return a JSON object');
  return body.slice(start, end + 1);
}

export function parseGoalPlan(raw: string): GoalPlan {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(raw));
  } catch (err) {
    if (err instanceof PlanError) throw err;
    fail(`the model returned invalid JSON (${err instanceof Error ? err.message : ''})`);
  }
  if (!isRecord(json)) fail('the model did not return a JSON object');

  const title = str(json.title, 'title');
  const goalLabel = str(json.goalLabel, 'goalLabel');
  const goalNote = typeof json.goalNote === 'string' ? json.goalNote.trim() : '';
  if (!Array.isArray(json.variables) || json.variables.length === 0) {
    fail('the plan needs at least one variable');
  }
  if (!Array.isArray(json.derived) || json.derived.length === 0) {
    fail('the plan needs at least one derived quantity');
  }

  const seen = new Set<string>();
  const claim = (name: string, where: string): string => {
    if (!IDENT.test(name)) fail(`${where}: "${name}" is not a valid identifier`);
    if (seen.has(name)) fail(`${where}: duplicate name "${name}"`);
    seen.add(name);
    return name;
  };

  const variables: PlanVariable[] = json.variables.map((v, i) => {
    if (!isRecord(v)) fail(`variables[${i}] is not an object`);
    const where = `variables[${i}]`;
    const name = claim(str(v.name, `${where}.name`), where);
    const value = num(v.value, `${where}.value`);
    let min = num(v.min, `${where}.min`);
    let max = num(v.max, `${where}.max`);
    if (min > max) [min, max] = [max, min];
    // Keep the slider usable even if the model's range excludes its own value.
    min = Math.min(min, value);
    max = Math.max(max, value);
    const step = num(v.step, `${where}.step`);
    return {
      name,
      label: str(v.label, `${where}.label`),
      value,
      unit: typeof v.unit === 'string' ? v.unit : '',
      min,
      max,
      step: step > 0 ? step : 1,
    };
  });

  const derived: PlanDerived[] = json.derived.map((d, i) => {
    if (!isRecord(d)) fail(`derived[${i}] is not an object`);
    const where = `derived[${i}]`;
    return {
      name: claim(str(d.name, `${where}.name`), where),
      label: str(d.label, `${where}.label`),
      formula: str(d.formula, `${where}.formula`),
      unit: typeof d.unit === 'string' ? d.unit : '',
      ...(typeof d.note === 'string' && d.note.trim() !== '' ? { note: d.note.trim() } : {}),
    };
  });

  const goalOf = str(json.goalOf, 'goalOf');
  if (!derived.some((d) => d.name === goalOf)) {
    fail(`goalOf "${goalOf}" is not one of the derived quantities`);
  }

  // Every symbol a formula reads must be something this plan defines.
  const known = new Set([...variables.map((v) => v.name), ...derived.map((d) => d.name)]);
  const deps = new Map<string, string[]>();
  for (const d of derived) {
    const symbols = formulaSymbols(d.formula, `derived "${d.name}"`);
    const unknown = symbols.filter((s) => !known.has(s));
    if (unknown.length > 0) {
      fail(`derived "${d.name}" references unknown ${unknown.map((u) => `"${u}"`).join(', ')}`);
    }
    if (symbols.includes(d.name)) fail(`derived "${d.name}" refers to itself`);
    deps.set(d.name, symbols);
  }
  assertAcyclic(derived, deps);

  return { title, goalLabel, goalNote, variables, derived, goalOf };
}

/** A cycle would leave every node on it stuck showing an error badge. */
function assertAcyclic(derived: PlanDerived[], deps: Map<string, string[]>): void {
  const state = new Map<string, 'open' | 'done'>();
  const walk = (name: string, trail: string[]): void => {
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'open') {
      fail(`circular formula: ${[...trail, name].join(' → ')}`);
    }
    state.set(name, 'open');
    for (const dep of deps.get(name) ?? []) walk(dep, [...trail, name]);
    state.set(name, 'done');
  };
  for (const d of derived) walk(d.name, []);
}

/**
 * Build a ready-to-load gyakusan session from an accepted plan. Node ids are
 * fresh and globally unique; `varName` carries the readable identifier the
 * formulas use, so two plans can both define `current_age` without colliding
 * in the database.
 */
export function planToSession(plan: GoalPlan, disclaimerMd: string): SessionExport {
  const sessionId = newId();
  const idOf = new Map<string, string>();
  const nodes: RNode[] = [];
  const edges: REdge[] = [];
  let seq = 0;

  const add = (node: Omit<RNode, 'sessionId' | 'seq'>): RNode => {
    const full: RNode = { ...node, sessionId, seq: ++seq } as RNode;
    nodes.push(full);
    return full;
  };

  for (const v of plan.variables) {
    const id = newId();
    idOf.set(v.name, id);
    add({
      id,
      kind: 'variable',
      varName: v.name,
      position: { x: 0, y: 0 },
      content: { md: `**${v.label}**`, highlights: [] },
      value: v.value,
      unit: v.unit,
      varInput: { min: v.min, max: v.max, step: v.step },
    });
  }

  for (const d of plan.derived) {
    const id = newId();
    idOf.set(d.name, id);
    add({
      id,
      // The quantity that answers the goal is rendered as the goal node.
      kind: d.name === plan.goalOf ? 'goal' : 'derived',
      varName: d.name,
      position: { x: 0, y: 0 },
      content: {
        md:
          d.name === plan.goalOf
            ? `**${plan.goalLabel}**\n\n${d.note ?? ''}`.trim()
            : `**${d.label}**${d.note ? `\n\n${d.note}` : ''}`,
        highlights: [],
      },
      formula: d.formula,
      unit: d.unit,
    });
  }

  // Wire dependencies from what each formula actually reads, rather than
  // trusting the model to list its own edges consistently.
  for (const d of plan.derived) {
    const targetId = idOf.get(d.name);
    if (targetId === undefined) continue;
    for (const symbol of formulaSymbols(d.formula, `derived "${d.name}"`)) {
      const sourceId = idOf.get(symbol);
      if (sourceId === undefined) continue;
      edges.push({ id: newId(), sessionId, kind: 'depends', source: sourceId, target: targetId });
    }
  }

  add({
    id: newId(),
    kind: 'chunk',
    position: { x: 0, y: 0 },
    content: { md: disclaimerMd, highlights: [] },
  });

  const session: Session = {
    id: sessionId,
    title: plan.title,
    mode: 'gyakusan',
    createdAt: Date.now(),
    seqCounter: seq,
  };

  // Lay the dependency layers out before the canvas ever sees the graph.
  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const edgeMap = Object.fromEntries(edges.map((e) => [e.id, e]));
  const positions = computeLayout(nodeMap, edgeMap);
  for (const node of nodes) {
    const p = positions[node.id];
    if (p) node.position = p;
  }

  return { schemaVersion: 1, session, nodes, edges };
}
