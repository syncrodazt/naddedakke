import type { Highlight, REdge, RNode, SessionExport } from '../src/model/types.js';

// Pure queries over one exported session. Kept free of I/O so the interesting
// logic — what counts as an open question, what the reasoning chain actually
// is — is testable without a filesystem or a network.
//
// `seq` is the app's chronological timeline and is never renumbered, so every
// "in the order I actually learned it" view here sorts by it.

export type NodeSummary = {
  id: string;
  seq: number;
  kind: RNode['kind'];
  /** First heading or line of the body — enough to recognise the node. */
  title: string;
  understood?: boolean;
};

export type ChainEntry = NodeSummary & {
  /** The node this one branched off, for question/answer nodes. */
  parentId?: string;
  /** The exact passage the learner highlighted to ask this. */
  quoted?: string;
  md: string;
};

const TITLE_LIMIT = 100;

/** A one-line label for a node: its heading if it has one, else its first line. */
export function nodeTitle(node: RNode): string {
  const heading = /^#{1,6}\s+(.+)$/m.exec(node.content.md);
  const line = heading?.[1] ?? node.content.md.split('\n').find((l) => l.trim() !== '') ?? '';
  const clean = line.replace(/[*_`>]/g, '').trim();
  return clean.length > TITLE_LIMIT ? `${clean.slice(0, TITLE_LIMIT)}…` : clean;
}

export function summarize(node: RNode): NodeSummary {
  return {
    id: node.id,
    seq: node.seq,
    kind: node.kind,
    title: nodeTitle(node),
    ...(node.understood !== undefined ? { understood: node.understood } : {}),
  };
}

function bySeq(nodes: RNode[]): RNode[] {
  return [...nodes].sort((a, b) => a.seq - b.seq);
}

/** The `why`/`reply` parent of a node — what it branched off, if anything. */
function parentOf(nodeId: string, edges: REdge[]): REdge | undefined {
  return edges.find((e) => e.target === nodeId && (e.kind === 'why' || e.kind === 'reply'));
}

/** The highlight in `parent` that spawned `childId`, if the link is intact. */
function anchorFor(parent: RNode | undefined, childId: string): Highlight | undefined {
  return parent?.content.highlights.find((h) => h.childNodeId === childId);
}

/**
 * The session as the learner actually built it: every node in `seq` order, each
 * question carrying the passage it was asked about. This is the text form of
 * the app's replay feature — "how did my understanding get here".
 */
export function reasoningChain(session: SessionExport): ChainEntry[] {
  const byId = new Map(session.nodes.map((n) => [n.id, n]));
  return bySeq(session.nodes).map((node) => {
    const edge = parentOf(node.id, session.edges);
    const parent = edge ? byId.get(edge.source) : undefined;
    const anchor = anchorFor(parent, node.id);
    return {
      ...summarize(node),
      ...(edge ? { parentId: edge.source } : {}),
      // Fall back to the anchor's denormalized text: offsets drift when a node
      // is regenerated, the quote does not.
      ...(anchor ? { quoted: anchor.text } : {}),
      md: node.content.md,
    };
  });
}

/** Node summaries in seq order — the cheap overview before fetching bodies. */
export function outline(session: SessionExport): NodeSummary[] {
  return bySeq(session.nodes).map(summarize);
}

export type OpenQuestion = NodeSummary & {
  reason: 'unanswered' | 'not-understood';
  quoted?: string;
  /** The answer node, when there is one that simply was not marked understood. */
  answerId?: string;
};

/**
 * Threads the learner has left hanging: questions with no answer, and answers
 * they never marked understood. Chunks are excluded — a lesson step is not a
 * loose end, only the learner's own branches are.
 */
export function openQuestions(session: SessionExport): OpenQuestion[] {
  const byId = new Map(session.nodes.map((n) => [n.id, n]));
  const out: OpenQuestion[] = [];

  for (const node of bySeq(session.nodes)) {
    if (node.kind !== 'question') continue;
    const edge = parentOf(node.id, session.edges);
    const quoted = anchorFor(edge ? byId.get(edge.source) : undefined, node.id)?.text;
    const reply = session.edges.find((e) => e.kind === 'reply' && e.source === node.id);
    const answer = reply ? byId.get(reply.target) : undefined;

    if (!answer) {
      out.push({ ...summarize(node), reason: 'unanswered', ...(quoted ? { quoted } : {}) });
    } else if (answer.understood !== true) {
      out.push({
        ...summarize(node),
        reason: 'not-understood',
        answerId: answer.id,
        ...(quoted ? { quoted } : {}),
      });
    }
  }
  return out;
}

export type SearchHit = NodeSummary & {
  sessionId: string;
  sessionTitle: string;
  /** The matching text with a little surrounding context. */
  excerpt: string;
};

const EXCERPT_PAD = 80;

/** Case-insensitive substring search across node bodies. */
export function searchNodes(sessions: SessionExport[], query: string, limit = 30): SearchHit[] {
  const needle = query.toLowerCase();
  if (needle === '') return [];
  const hits: SearchHit[] = [];

  for (const session of sessions) {
    for (const node of bySeq(session.nodes)) {
      const at = node.content.md.toLowerCase().indexOf(needle);
      if (at === -1) continue;
      const start = Math.max(0, at - EXCERPT_PAD);
      const end = Math.min(node.content.md.length, at + needle.length + EXCERPT_PAD);
      hits.push({
        ...summarize(node),
        sessionId: session.session.id,
        sessionTitle: session.session.title,
        excerpt:
          (start > 0 ? '…' : '') +
          node.content.md.slice(start, end).replace(/\s+/g, ' ') +
          (end < node.content.md.length ? '…' : ''),
      });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

export type NodeDetail = ChainEntry & {
  /** Question nodes this node's own highlights spawned. */
  children: NodeSummary[];
  /** gyakusan only. */
  formula?: string;
  value?: number;
  unit?: string;
};

export function nodeDetail(session: SessionExport, nodeId: string): NodeDetail | null {
  const node = session.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const byId = new Map(session.nodes.map((n) => [n.id, n]));
  const entry = reasoningChain(session).find((e) => e.id === nodeId);
  if (!entry) return null;

  const children = node.content.highlights
    .map((h) => (h.childNodeId ? byId.get(h.childNodeId) : undefined))
    .filter((n): n is RNode => n !== undefined)
    .map(summarize);

  return {
    ...entry,
    children,
    ...(node.formula !== undefined ? { formula: node.formula } : {}),
    ...(node.value !== undefined ? { value: node.value } : {}),
    ...(node.unit !== undefined ? { unit: node.unit } : {}),
  };
}
