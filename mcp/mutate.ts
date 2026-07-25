import type { Highlight, REdge, RNode, Session, SessionExport } from '../src/model/types';
import {
  answerPosition,
  branchDepth,
  branchPosition,
  spinePosition,
  whySiblingCount,
} from '../src/layout/layout';
import { recomputeGraph } from '../src/gyakusan/engine';

// Writes into a session, as pure functions: each takes a SessionExport and
// returns a new one. Persisting is sources.ts's job; the invariants are here,
// where they can be tested without a filesystem.
//
// Three rules the app depends on, enforced at this layer rather than trusted to
// the caller:
//
//  1. `seq` is the chronological timeline. New nodes take the next number from
//     session.seqCounter. It is never reused, never renumbered, never rewound.
//  2. Every question branch anchors to a real highlight in its parent's
//     markdown. A branch with no anchor is a bug in this app, so a quote that
//     cannot be located in the parent is rejected instead of being stored as a
//     dangling branch.
//  3. Placement reuses the app's own layout helpers, so a node written from
//     here lands exactly where the same node created in the browser would.
//
// What is deliberately absent: nothing here edits or deletes existing node
// markdown. The graph is the learner's record of how their understanding was
// built — appending to it is useful, silently rewriting it is corruption.

export class WriteError extends Error {}

function fail(message: string): never {
  throw new WriteError(message);
}

const uuid = (): string => crypto.randomUUID();

function byId(exp: SessionExport): Record<string, RNode> {
  return Object.fromEntries(exp.nodes.map((n) => [n.id, n]));
}

function edgeMap(exp: SessionExport): Record<string, REdge> {
  return Object.fromEntries(exp.edges.map((e) => [e.id, e]));
}

/** Take the next seq, advancing the session counter. Never rewinds. */
function withNextSeq(session: Session): { session: Session; seq: number } {
  const seq = session.seqCounter + 1;
  return { session: { ...session, seqCounter: seq }, seq };
}

function require_(exp: SessionExport, nodeId: string): RNode {
  const node = exp.nodes.find((n) => n.id === nodeId);
  return node ?? fail(`no node "${nodeId}" in session "${exp.session.id}"`);
}

export function createSession(title: string, mode: Session['mode'], now: number): SessionExport {
  return {
    schemaVersion: 1,
    session: { id: uuid(), title, mode, createdAt: now, seqCounter: 0 },
    nodes: [],
    edges: [],
  };
}

/** Append a lesson step to the spine, chained to the previous one by `next`. */
export function addChunk(exp: SessionExport, md: string): { next: SessionExport; nodeId: string } {
  if (md.trim() === '') fail('chunk markdown is empty');
  const chunks = exp.nodes.filter((n) => n.kind === 'chunk').sort((a, b) => a.seq - b.seq);
  const prev = chunks[chunks.length - 1];
  const { session, seq } = withNextSeq(exp.session);

  const node: RNode = {
    id: uuid(),
    sessionId: session.id,
    kind: 'chunk',
    seq,
    position: spinePosition(chunks.length),
    content: { md, highlights: [] },
  };

  return {
    next: {
      ...exp,
      session,
      nodes: [...exp.nodes, node],
      edges: prev
        ? [
            ...exp.edges,
            { id: uuid(), sessionId: session.id, kind: 'next', source: prev.id, target: node.id },
          ]
        : exp.edges,
    },
    nodeId: node.id,
  };
}

/**
 * Branch a question off an exact passage of its parent. `quotedText` must occur
 * verbatim in the parent's markdown — that is what makes the pink underline in
 * the parent, and the camera link back to it, work at all.
 */
export function addQuestion(
  exp: SessionExport,
  parentNodeId: string,
  quotedText: string,
  question: string,
): { next: SessionExport; nodeId: string } {
  const parent = require_(exp, parentNodeId);
  if (question.trim() === '') fail('question text is empty');
  if (quotedText.trim() === '') {
    fail('quotedText is empty — a question must anchor to a passage of its parent');
  }

  // Prefer a passage not already spoken for, so two questions about the same
  // repeated phrase do not both underline the first occurrence.
  const taken = parent.content.highlights.map((h) => h.end);
  let start = -1;
  for (let from = 0; ;) {
    const at = parent.content.md.indexOf(quotedText, from);
    if (at === -1) break;
    if (start === -1) start = at;
    if (!taken.includes(at + quotedText.length)) {
      start = at;
      break;
    }
    from = at + 1;
  }
  if (start === -1) {
    fail(
      `quotedText not found in node "${parentNodeId}". It must be copied verbatim from that ` +
        `node's markdown (get_node returns it).`,
    );
  }

  const { session, seq } = withNextSeq(exp.session);
  const nodeId = uuid();
  const highlight: Highlight = {
    id: uuid(),
    start,
    end: start + quotedText.length,
    text: quotedText,
    childNodeId: nodeId,
  };

  const edges = edgeMap(exp);
  const node: RNode = {
    id: nodeId,
    sessionId: session.id,
    kind: 'question',
    seq,
    position: branchPosition(
      parent,
      branchDepth(parentNodeId, edges) + 1,
      whySiblingCount(parentNodeId, edges),
    ),
    branchIntent: 'why',
    // Same body shape the app writes: the quote, then the question.
    content: { md: `> ${quotedText}\n\n${question}`, highlights: [] },
  };

  return {
    next: {
      ...exp,
      session,
      nodes: [
        ...exp.nodes.map((n) =>
          n.id === parentNodeId
            ? { ...n, content: { ...n.content, highlights: [...n.content.highlights, highlight] } }
            : n,
        ),
        node,
      ],
      edges: [
        ...exp.edges,
        { id: uuid(), sessionId: session.id, kind: 'why', source: parentNodeId, target: nodeId },
      ],
    },
    nodeId,
  };
}

/** Answer a question node. One answer per question — the app links them 1:1. */
export function addAnswer(
  exp: SessionExport,
  questionId: string,
  md: string,
): { next: SessionExport; nodeId: string } {
  const question = require_(exp, questionId);
  if (question.kind !== 'question')
    fail(`node "${questionId}" is a ${question.kind}, not a question`);
  if (md.trim() === '') fail('answer markdown is empty');
  const existing = exp.edges.find((e) => e.kind === 'reply' && e.source === questionId);
  if (existing) {
    fail(`question "${questionId}" already has answer "${existing.target}"`);
  }

  const { session, seq } = withNextSeq(exp.session);
  const node: RNode = {
    id: uuid(),
    sessionId: session.id,
    kind: 'answer',
    seq,
    position: answerPosition(question),
    content: { md, highlights: [] },
  };

  return {
    next: {
      ...exp,
      session,
      nodes: [...exp.nodes, node],
      edges: [
        ...exp.edges,
        { id: uuid(), sessionId: session.id, kind: 'reply', source: questionId, target: node.id },
      ],
    },
    nodeId: node.id,
  };
}

/** Flip the learner's "I get this now" flag. */
export function markUnderstood(
  exp: SessionExport,
  nodeId: string,
  understood: boolean,
): SessionExport {
  require_(exp, nodeId);
  return {
    ...exp,
    nodes: exp.nodes.map((n) => (n.id === nodeId ? { ...n, understood } : n)),
  };
}

/**
 * Move a back-cast variable and recompute everything downstream, using the
 * app's own dataflow engine so the stored values match what the canvas shows.
 */
export function setVariable(
  exp: SessionExport,
  nodeId: string,
  value: number,
): { next: SessionExport; issues: Record<string, string> } {
  const node = require_(exp, nodeId);
  if (node.formula !== undefined) {
    fail(`node "${nodeId}" is computed from a formula; move the variables it depends on instead`);
  }
  if (!Number.isFinite(value)) fail('value must be a finite number');
  if (node.varInput) {
    const { min, max } = node.varInput;
    if (value < min || value > max)
      fail(`value ${value} is outside this variable's range ${min}–${max}`);
  }

  const moved = exp.nodes.map((n) => (n.id === nodeId ? { ...n, value } : n));
  const { values, issues } = recomputeGraph(
    Object.fromEntries(moved.map((n) => [n.id, n])),
    edgeMap(exp),
  );

  return {
    next: {
      ...exp,
      nodes: moved.map((n) => (values[n.id] !== undefined ? { ...n, value: values[n.id] } : n)),
    },
    issues,
  };
}

/** A short human summary of what a write did, for the tool's reply. */
export function describeWrite(exp: SessionExport, nodeId?: string): Record<string, unknown> {
  const node = nodeId ? byId(exp)[nodeId] : undefined;
  return {
    sessionId: exp.session.id,
    seqCounter: exp.session.seqCounter,
    nodeCount: exp.nodes.length,
    ...(node ? { node: { id: node.id, seq: node.seq, kind: node.kind } } : {}),
  };
}
