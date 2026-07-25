import { describe, expect, it } from 'vitest';
import type { REdge, RNode, SessionExport } from '../src/model/types.js';
import {
  nodeDetail,
  nodeTitle,
  openQuestions,
  outline,
  reasoningChain,
  searchNodes,
} from './graph.js';
import { isSessionExport } from './sources.js';

function node(
  p: Partial<RNode> & { id: string; seq: number; kind: RNode['kind']; md: string },
): RNode {
  const { md, ...rest } = p;
  return {
    sessionId: 's1',
    position: { x: 0, y: 0 },
    content: { md, highlights: [] },
    ...rest,
  } as RNode;
}

function edge(id: string, kind: REdge['kind'], source: string, target: string): REdge {
  return { id, sessionId: 's1', kind, source, target };
}

/**
 * A small but complete session: two spine chunks, a why-branch off a highlight
 * in chunk 1 with an answer the learner understood, and a second question that
 * was never answered.
 */
function fixture(): SessionExport {
  const c1 = node({
    id: 'c1',
    seq: 1,
    kind: 'chunk',
    md: '## 複利とは\n\n利子が元本に組み込まれます。',
  });
  c1.content.highlights = [
    { id: 'h1', start: 10, end: 20, text: '利子が元本に組み込まれます', childNodeId: 'q1' },
    { id: 'h2', start: 21, end: 25, text: '元本', childNodeId: 'q2' },
  ];
  return {
    schemaVersion: 1,
    session: { id: 's1', title: '複利', mode: 'learn', createdAt: 1000, seqCounter: 5 },
    // Deliberately NOT in seq order: a real export is sorted, but nothing in
    // these queries may depend on that — `seq` is the timeline, array position
    // is not. Left in order, every ordering assertion below would pass even if
    // the sort were deleted.
    nodes: [
      node({ id: 'c2', seq: 5, kind: 'chunk', md: '## 72の法則\n\n倍増年数の近似です。' }),
      node({
        id: 'a1',
        seq: 3,
        kind: 'answer',
        md: '掛け算の繰り返しだからです。',
        understood: true,
      }),
      node({ id: 'q2', seq: 4, kind: 'question', md: '> 元本\n\n元本って何？' }),
      c1,
      node({ id: 'q1', seq: 2, kind: 'question', md: '> 利子が元本に組み込まれます\n\nなんで？' }),
    ],
    edges: [
      edge('e1', 'next', 'c1', 'c2'),
      edge('e2', 'why', 'c1', 'q1'),
      edge('e3', 'reply', 'q1', 'a1'),
      edge('e4', 'why', 'c1', 'q2'),
    ],
  };
}

describe('nodeTitle', () => {
  it('prefers the heading, else the first non-empty line', () => {
    expect(nodeTitle(node({ id: 'x', seq: 1, kind: 'chunk', md: '## 複利とは\n\n本文' }))).toBe(
      '複利とは',
    );
    expect(nodeTitle(node({ id: 'x', seq: 1, kind: 'answer', md: '\n\n**太字**の答え' }))).toBe(
      '太字の答え',
    );
    expect(nodeTitle(node({ id: 'x', seq: 1, kind: 'chunk', md: '' }))).toBe('');
  });
});

describe('reasoningChain', () => {
  const chain = reasoningChain(fixture());

  it('walks the session in seq order, never in array or position order', () => {
    expect(chain.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('carries the highlighted passage each question branched off', () => {
    // A branch with no anchor is a bug in this app, so the chain must show one.
    const q1 = chain.find((e) => e.id === 'q1');
    expect(q1?.parentId).toBe('c1');
    expect(q1?.quoted).toBe('利子が元本に組み込まれます');
  });

  it('links an answer back to its question', () => {
    expect(chain.find((e) => e.id === 'a1')?.parentId).toBe('q1');
  });

  it('leaves spine chunks unparented — `next` is order, not derivation', () => {
    expect(chain.find((e) => e.id === 'c2')?.parentId).toBeUndefined();
  });

  it('reads the quote from the highlight text, not from md offsets', () => {
    // Offsets drift when a node is regenerated; the denormalized quote is the
    // guard, so the chain must not re-slice the markdown.
    const session = fixture();
    session.nodes.find((n) => n.id === 'c1')!.content.md = 'completely different text';
    expect(reasoningChain(session).find((e) => e.id === 'q1')?.quoted).toBe(
      '利子が元本に組み込まれます',
    );
  });
});

describe('openQuestions', () => {
  it('reports a question with no answer', () => {
    const open = openQuestions(fixture());
    expect(open.map((o) => o.id)).toEqual(['q2']);
    expect(open[0]?.reason).toBe('unanswered');
    expect(open[0]?.quoted).toBe('元本');
  });

  it('reports an answered question the learner never marked understood', () => {
    const session = fixture();
    session.nodes.find((n) => n.id === 'a1')!.understood = false;
    const open = openQuestions(session);
    expect(open.map((o) => [o.id, o.reason])).toEqual([
      ['q1', 'not-understood'],
      ['q2', 'unanswered'],
    ]);
    expect(open[0]?.answerId).toBe('a1');
  });

  it('never counts a lesson chunk as a loose end', () => {
    // Chunks are the tutor's steps, not the learner's questions.
    expect(openQuestions(fixture()).some((o) => o.kind === 'chunk')).toBe(false);
  });
});

describe('outline', () => {
  it('summarizes every node in seq order with its understood flag', () => {
    expect(outline(fixture())).toEqual([
      { id: 'c1', seq: 1, kind: 'chunk', title: '複利とは' },
      { id: 'q1', seq: 2, kind: 'question', title: '利子が元本に組み込まれます' },
      { id: 'a1', seq: 3, kind: 'answer', title: '掛け算の繰り返しだからです。', understood: true },
      { id: 'q2', seq: 4, kind: 'question', title: '元本' },
      { id: 'c2', seq: 5, kind: 'chunk', title: '72の法則' },
    ]);
  });
});

describe('searchNodes', () => {
  it('finds matches across sessions and quotes surrounding context', () => {
    const hits = searchNodes([fixture()], '72の法則');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe('c2');
    expect(hits[0]?.sessionTitle).toBe('複利');
    expect(hits[0]?.excerpt).toContain('72の法則');
  });

  it('is case-insensitive and honours the limit', () => {
    const session = fixture();
    session.nodes.forEach((n) => (n.content.md += ' COMPOUND'));
    expect(searchNodes([session], 'compound')).toHaveLength(5);
    expect(searchNodes([session], 'compound', 2)).toHaveLength(2);
  });

  it('returns nothing for an empty query rather than everything', () => {
    expect(searchNodes([fixture()], '')).toEqual([]);
  });
});

describe('nodeDetail', () => {
  it('lists the questions a node’s own highlights spawned', () => {
    const detail = nodeDetail(fixture(), 'c1');
    expect(detail?.children.map((c) => c.id)).toEqual(['q1', 'q2']);
    expect(detail?.md).toContain('利子が元本に組み込まれます');
  });

  it('surfaces gyakusan formula and value', () => {
    const session = fixture();
    session.nodes.push(
      node({
        id: 'd1',
        seq: 6,
        kind: 'derived',
        md: '**必要額**',
        formula: 'a * b',
        value: 42,
        unit: '万円',
      }),
    );
    const detail = nodeDetail(session, 'd1');
    expect(detail?.formula).toBe('a * b');
    expect(detail?.value).toBe(42);
    expect(detail?.unit).toBe('万円');
  });

  it('returns null for an unknown node', () => {
    expect(nodeDetail(fixture(), 'nope')).toBeNull();
  });
});

describe('isSessionExport', () => {
  it('accepts a real export and rejects near-misses', () => {
    expect(isSessionExport(fixture())).toBe(true);
    expect(isSessionExport({ ...fixture(), schemaVersion: 2 })).toBe(false);
    expect(isSessionExport({ ...fixture(), nodes: 'many' })).toBe(false);
    expect(isSessionExport({ schemaVersion: 1, session: null, nodes: [], edges: [] })).toBe(false);
    expect(isSessionExport(null)).toBe(false);
    expect(isSessionExport('{}')).toBe(false);
  });
});
