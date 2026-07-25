import { describe, expect, it } from 'vitest';
import type { SessionExport } from '../src/model/types';
import {
  WriteError,
  addAnswer,
  addChunk,
  addQuestion,
  createSession,
  markUnderstood,
  setVariable,
} from './mutate';
import { fileNameFor } from './sources';
import { reasoningChain } from './graph';
import { validateImport } from '../src/db/exportImport';

function empty(): SessionExport {
  return createSession('複利', 'learn', 1000);
}

/** A session with one chunk, so branch tests have something to anchor to. */
function withChunk(): { exp: SessionExport; chunkId: string } {
  const { next, nodeId } = addChunk(empty(), '## 複利とは\n\n利子が元本に組み込まれます。');
  return { exp: next, chunkId: nodeId };
}

describe('seq allocation', () => {
  it('advances the session counter and never reuses a number', () => {
    let exp = empty();
    const seqs: number[] = [];
    for (const md of ['## 一\n本文', '## 二\n本文', '## 三\n本文']) {
      const r = addChunk(exp, md);
      exp = r.next;
      seqs.push(exp.nodes.find((n) => n.id === r.nodeId)!.seq);
    }
    expect(seqs).toEqual([1, 2, 3]);
    expect(exp.session.seqCounter).toBe(3);
  });

  it('keeps counting past nodes that already exist at a higher seq', () => {
    // The counter is the source of truth, not the node array's length: a
    // session that lost nodes must not hand out a seq it already used.
    const { exp } = withChunk();
    const bumped = { ...exp, session: { ...exp.session, seqCounter: 42 } };
    const { next, nodeId } = addChunk(bumped, '## 二\n本文');
    expect(next.nodes.find((n) => n.id === nodeId)!.seq).toBe(43);
  });

  it('interleaves question and answer in the order they were written', () => {
    const { exp, chunkId } = withChunk();
    const q = addQuestion(exp, chunkId, '利子が元本に組み込まれます', 'なんで？');
    const a = addAnswer(q.next, q.nodeId, '掛け算の繰り返しだからです。');
    expect(reasoningChain(a.next).map((e) => e.kind)).toEqual(['chunk', 'question', 'answer']);
  });
});

describe('addChunk', () => {
  it('chains each chunk to the previous one with a `next` edge', () => {
    const first = addChunk(empty(), '## 一\n本文');
    const second = addChunk(first.next, '## 二\n本文');
    const nexts = second.next.edges.filter((e) => e.kind === 'next');
    expect(nexts).toHaveLength(1);
    expect(nexts[0]).toMatchObject({ source: first.nodeId, target: second.nodeId });
  });

  it('leaves the first chunk unchained and lays chunks out left to right', () => {
    const first = addChunk(empty(), '## 一\n本文');
    expect(first.next.edges).toHaveLength(0);
    const second = addChunk(first.next, '## 二\n本文');
    const [a, b] = [first.nodeId, second.nodeId].map(
      (id) => second.next.nodes.find((n) => n.id === id)!.position,
    );
    expect(b!.x).toBeGreaterThan(a!.x);
    expect(b!.y).toBe(a!.y);
  });

  it('refuses an empty body rather than creating a blank node', () => {
    expect(() => addChunk(empty(), '   ')).toThrow(WriteError);
  });
});

describe('addQuestion', () => {
  it('anchors the branch to real offsets into the parent markdown', () => {
    const { exp, chunkId } = withChunk();
    const { next, nodeId } = addQuestion(exp, chunkId, '利子が元本に組み込まれます', 'なんで？');
    const parent = next.nodes.find((n) => n.id === chunkId)!;
    const h = parent.content.highlights[0]!;

    expect(h.childNodeId).toBe(nodeId);
    // The offsets must actually address that passage — this is what draws the
    // underline in the right place.
    expect(parent.content.md.slice(h.start, h.end)).toBe('利子が元本に組み込まれます');
  });

  it('creates the why edge and quotes the passage in the question body', () => {
    const { exp, chunkId } = withChunk();
    const { next, nodeId } = addQuestion(exp, chunkId, '元本', 'なんで元本なの？');
    expect(next.edges.filter((e) => e.kind === 'why')).toMatchObject([
      { source: chunkId, target: nodeId },
    ]);
    expect(next.nodes.find((n) => n.id === nodeId)!.content.md).toBe('> 元本\n\nなんで元本なの？');
  });

  it('rejects a quote that is not in the parent, instead of a dangling branch', () => {
    // A branch with no anchor is a bug in this app; a paraphrased quote is the
    // most likely way an assistant would create one.
    const { exp, chunkId } = withChunk();
    expect(() => addQuestion(exp, chunkId, 'interest compounds', 'why?')).toThrow(
      /not found in node/,
    );
    expect(() => addQuestion(exp, chunkId, '  ', 'why?')).toThrow(WriteError);
  });

  it('anchors a repeated phrase to a free occurrence, not the taken one', () => {
    const { next: exp, nodeId: chunkId } = addChunk(empty(), '複利は複利です');
    const first = addQuestion(exp, chunkId, '複利', 'なんで？');
    const second = addQuestion(first.next, chunkId, '複利', 'もう一回なんで？');
    const [h1, h2] = second.next.nodes.find((n) => n.id === chunkId)!.content.highlights;
    expect(h1!.start).not.toBe(h2!.start);
  });

  it('refuses to branch off a node that does not exist', () => {
    expect(() => addQuestion(withChunk().exp, 'ghost', 'x', 'why?')).toThrow(/no node "ghost"/);
  });
});

describe('addAnswer', () => {
  it('links the answer to its question with a reply edge', () => {
    const { exp, chunkId } = withChunk();
    const q = addQuestion(exp, chunkId, '元本', 'なんで？');
    const a = addAnswer(q.next, q.nodeId, '掛け算だからです。');
    expect(a.next.edges.filter((e) => e.kind === 'reply')).toMatchObject([
      { source: q.nodeId, target: a.nodeId },
    ]);
  });

  it('refuses a second answer to the same question', () => {
    // The app links them 1:1; two replies would render as a broken pair.
    const { exp, chunkId } = withChunk();
    const q = addQuestion(exp, chunkId, '元本', 'なんで？');
    const a = addAnswer(q.next, q.nodeId, '一つ目');
    expect(() => addAnswer(a.next, q.nodeId, '二つ目')).toThrow(/already has answer/);
  });

  it('refuses to answer something that is not a question node', () => {
    const { exp, chunkId } = withChunk();
    expect(() => addAnswer(exp, chunkId, 'answer')).toThrow(/is a chunk, not a question/);
  });
});

describe('markUnderstood', () => {
  it('sets and clears the flag without touching anything else', () => {
    const { exp, chunkId } = withChunk();
    const on = markUnderstood(exp, chunkId, true);
    expect(on.nodes.find((n) => n.id === chunkId)!.understood).toBe(true);
    expect(on.session).toEqual(exp.session); // no seq consumed
    expect(markUnderstood(on, chunkId, false).nodes.find((n) => n.id === chunkId)!.understood).toBe(
      false,
    );
  });
});

describe('setVariable', () => {
  function gyakusan(): SessionExport {
    const base = createSession('FIRE', 'gyakusan', 1000);
    return {
      ...base,
      session: { ...base.session, seqCounter: 3 },
      nodes: [
        {
          id: 'v1',
          sessionId: base.session.id,
          kind: 'variable',
          seq: 1,
          position: { x: 0, y: 0 },
          content: { md: '**年収**', highlights: [] },
          varName: 'income',
          value: 500,
          varInput: { min: 0, max: 2000, step: 10 },
        },
        {
          id: 'v2',
          sessionId: base.session.id,
          kind: 'variable',
          seq: 2,
          position: { x: 0, y: 0 },
          content: { md: '**貯蓄率**', highlights: [] },
          varName: 'rate',
          value: 0.3,
          varInput: { min: 0, max: 1, step: 0.01 },
        },
        {
          id: 'd1',
          sessionId: base.session.id,
          kind: 'goal',
          seq: 3,
          position: { x: 0, y: 0 },
          content: { md: '**年間貯蓄**', highlights: [] },
          varName: 'saved',
          formula: 'income * rate',
        },
      ],
      edges: [
        { id: 'e1', sessionId: base.session.id, kind: 'depends', source: 'v1', target: 'd1' },
        { id: 'e2', sessionId: base.session.id, kind: 'depends', source: 'v2', target: 'd1' },
      ],
    };
  }

  it('recomputes downstream values with the app’s own engine', () => {
    const { next, issues } = setVariable(gyakusan(), 'v1', 1000);
    expect(next.nodes.find((n) => n.id === 'd1')!.value).toBe(300);
    expect(issues).toEqual({});
  });

  it('refuses a value outside the variable’s own slider range', () => {
    expect(() => setVariable(gyakusan(), 'v1', 99999)).toThrow(/outside this variable's range/);
  });

  it('refuses to set a derived node directly', () => {
    expect(() => setVariable(gyakusan(), 'd1', 42)).toThrow(/computed from a formula/);
  });
});

describe('what is written is what the app can load', () => {
  it('passes the app’s own import validator', () => {
    // The MCP server and the app write the same store. If a written session
    // cannot survive validateImport, it cannot be pulled into the canvas —
    // which would make every write silently useless.
    const { exp, chunkId } = withChunk();
    const q = addQuestion(exp, chunkId, '利子が元本に組み込まれます', 'なんで？');
    const a = addAnswer(q.next, q.nodeId, '掛け算の繰り返しだからです。');
    const final = markUnderstood(a.next, chunkId, true);

    // Round-trip through JSON exactly as the file/cloud blob does.
    const loaded = validateImport(JSON.parse(JSON.stringify(final)));
    expect(loaded.nodes.map((n) => n.seq)).toEqual([1, 2, 3]);
    expect(loaded.session.seqCounter).toBe(3);
    expect(loaded.nodes.find((n) => n.id === chunkId)!.content.highlights[0]!.childNodeId).toBe(
      q.nodeId,
    );
  });
});

describe('fileNameFor', () => {
  it('is stable across edits, so a rewrite lands in the same file', () => {
    const exp = empty();
    const grown = addChunk(addChunk(exp, '## 一\n本文').next, '## 二\n本文').next;
    expect(fileNameFor(grown)).toBe(fileNameFor(exp));
  });

  it('keeps non-ASCII titles readable and always carries the id', () => {
    const exp = empty();
    expect(fileNameFor(exp)).toBe(`複利-${exp.session.id}.json`);
  });

  it('falls back to a name when the title has nothing usable', () => {
    const exp = createSession('///', 'learn', 1);
    expect(fileNameFor(exp)).toBe(`session-${exp.session.id}.json`);
  });
});
