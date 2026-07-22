import type { REdge, RNode, Session, SessionExport } from '../model/types';
import { answerPosition, branchPosition, spinePosition } from '../layout/layout';

// Compact builder for hand-authored learn-mode example sessions: a spine of
// lesson chunks (left→right) with optional なんで？ branches (question + answer)
// hanging off a chunk, each anchored to a real phrase inside that chunk.

export type ChunkSpec = { md: string };
export type BranchSpec = {
  chunkIndex: number; // which spine chunk (0-based) this branches off
  anchor: string; // a verbatim phrase inside that chunk's md
  question: string; // the なんで？ question markdown
  answer: string; // the answer markdown
};

export function buildLearnFixture(
  id: string,
  title: string,
  createdAt: number,
  chunkSpecs: ChunkSpec[],
  branchSpecs: BranchSpec[] = [],
): SessionExport {
  const nodes: RNode[] = [];
  const edges: REdge[] = [];
  let seq = 0;
  const node = (n: Omit<RNode, 'sessionId'>): RNode => {
    const full = { ...n, sessionId: id };
    nodes.push(full);
    return full;
  };
  const edge = (eid: string, kind: REdge['kind'], source: string, target: string) =>
    edges.push({ id: eid, sessionId: id, kind, source, target });

  const chunks = chunkSpecs.map((spec, i) => {
    const c = node({
      id: `${id}-c${i + 1}`,
      kind: 'chunk',
      seq: ++seq,
      position: spinePosition(i),
      content: { md: spec.md, highlights: [] },
    });
    if (i > 0) edge(`${id}-next-${i}`, 'next', `${id}-c${i}`, c.id);
    return c;
  });

  branchSpecs.forEach((b, bi) => {
    const parent = chunks[b.chunkIndex];
    if (!parent) throw new Error(`branch ${bi}: no chunk ${b.chunkIndex}`);
    const start = parent.content.md.indexOf(b.anchor);
    if (start === -1) throw new Error(`branch ${bi}: anchor not found: ${b.anchor}`);

    const qId = `${id}-q${bi + 1}`;
    const aId = `${id}-a${bi + 1}`;
    const siblingIndex = parent.content.highlights.length;
    parent.content.highlights.push({
      id: `${id}-hl${bi + 1}`,
      start,
      end: start + b.anchor.length,
      text: b.anchor,
      childNodeId: qId,
    });

    const question = node({
      id: qId,
      kind: 'question',
      seq: ++seq,
      position: branchPosition(parent, 1, siblingIndex),
      branchIntent: 'why',
      content: { md: `> ${b.anchor}\n\n${b.question}`, highlights: [] },
    });
    edge(`${id}-why${bi + 1}`, 'why', parent.id, qId);

    node({
      id: aId,
      kind: 'answer',
      seq: ++seq,
      position: answerPosition(question),
      content: { md: b.answer, highlights: [] },
    });
    edge(`${id}-reply${bi + 1}`, 'reply', qId, aId);
  });

  const session: Session = { id, title, mode: 'learn', createdAt, seqCounter: seq };
  return { schemaVersion: 1, session, nodes, edges };
}
