import { writeFileSync } from 'node:fs';
import type { REdge, RNode, SessionExport } from '../src/model/types';
import { computeLayout } from '../src/layout/layout';

// Generates a large but *realistic* session for the canvas benchmark: a spine of
// lesson chunks, each with a couple of why-branches and their answers, prose
// bodies of the length the tutor actually writes, and highlights anchored into
// them. A graph of 200 empty boxes would measure nothing — the cost of this app
// is markdown bodies and anchored highlights, not rectangles.
//
//   npx vite-node bench/generate.ts -- 240 bench/fixtures/bench-240.json

const BODY = [
  '複利の効果は、利子が元本に組み込まれることで生まれます。',
  '1年目の残高は元本×(1+r)、2年目はその全体にまた(1+r)が掛かります。',
  'つまりn年後は元本×(1+r)^n となり、増え方は直線ではなく指数カーブを描きます。',
  '倍増にかかる年数は $(1+r)^t = 2$ を解けば求まり、$t = \\ln 2 / \\ln(1+r) \\approx 0.693/r$ です。',
  'この近似から、実務で使いやすい「72の法則」が出てきます。',
].join('\n\n');

const QUOTES = ['利子が元本に組み込まれる', '指数カーブ', '72の法則', '元本'];

function newId(seed: number): string {
  // Deterministic ids: a benchmark that generates different graphs each run
  // cannot be compared against its own earlier numbers.
  return `n${seed.toString(36).padStart(6, '0')}`;
}

export function generateSession(targetNodes: number): SessionExport {
  const sessionId = 'bench-session';
  const nodes: RNode[] = [];
  const edges: REdge[] = [];
  let seq = 0;
  let ids = 0;

  const add = (node: Omit<RNode, 'sessionId' | 'seq'>): RNode => {
    const full = { ...node, sessionId, seq: ++seq } as RNode;
    nodes.push(full);
    return full;
  };

  let prevChunk: RNode | null = null;
  let chunkIndex = 0;

  while (nodes.length < targetNodes) {
    const chunk = add({
      id: newId(++ids),
      kind: 'chunk',
      position: { x: 0, y: 0 },
      content: { md: `## 第${chunkIndex + 1}章 複利\n\n${BODY}`, highlights: [] },
    });
    if (prevChunk) {
      edges.push({
        id: newId(++ids),
        sessionId,
        kind: 'next',
        source: prevChunk.id,
        target: chunk.id,
      });
    }
    prevChunk = chunk;

    // Two why-branches per chunk, each answered — the shape a real session has.
    for (let b = 0; b < 2 && nodes.length < targetNodes; b += 1) {
      const quote = QUOTES[(chunkIndex + b) % QUOTES.length]!;
      const start = chunk.content.md.indexOf(quote);
      if (start === -1) continue;

      const question = add({
        id: newId(++ids),
        kind: 'question',
        position: { x: 0, y: 0 },
        branchIntent: 'why',
        content: { md: `> ${quote}\n\nなんで？もう少し詳しく知りたいです。`, highlights: [] },
      });
      chunk.content.highlights.push({
        id: newId(++ids),
        start,
        end: start + quote.length,
        text: quote,
        childNodeId: question.id,
      });
      edges.push({
        id: newId(++ids),
        sessionId,
        kind: 'why',
        source: chunk.id,
        target: question.id,
      });

      if (nodes.length >= targetNodes) break;
      const answer = add({
        id: newId(++ids),
        kind: 'answer',
        position: { x: 0, y: 0 },
        understood: b === 0,
        content: { md: `${quote}について。\n\n${BODY}`, highlights: [] },
      });
      edges.push({
        id: newId(++ids),
        sessionId,
        kind: 'reply',
        source: question.id,
        target: answer.id,
      });
    }
    chunkIndex += 1;
  }

  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const edgeMap = Object.fromEntries(edges.map((e) => [e.id, e]));
  const positions = computeLayout(nodeMap, edgeMap);
  for (const node of nodes) {
    const p = positions[node.id];
    if (p) node.position = p;
  }

  return {
    schemaVersion: 1,
    session: {
      id: sessionId,
      title: `ベンチマーク ${nodes.length} nodes`,
      mode: 'learn',
      createdAt: 0,
      seqCounter: seq,
    },
    nodes,
    edges,
  };
}

const [countArg, outArg] = process.argv.slice(2).filter((a) => a !== '--');
const count = Number(countArg ?? 240);
const out = outArg ?? `bench/fixtures/bench-${count}.json`;
writeFileSync(out, JSON.stringify(generateSession(count)));
process.stdout.write(`${out}: ${generateSession(count).nodes.length} nodes\n`);
