import type { REdge, RNode, Session, SessionExport } from '../model/types';
import { answerPosition, branchPosition, spinePosition } from '../layout/layout';

// Hardcoded demo session: a 4-chunk lesson spine about compound interest, with
// one なんで？ branch (question + answer) hanging off chunk 2, and a deeper
// recursive branch off that answer. Used to exercise the canvas (M1) and to
// seed the first session in the data layer (M2).

const SESSION_ID = 'fixture-session';

function n(
  id: string,
  kind: RNode['kind'],
  seq: number,
  position: { x: number; y: number },
  md: string,
  highlights: RNode['content']['highlights'] = [],
): RNode {
  return { id, sessionId: SESSION_ID, kind, seq, position, content: { md, highlights } };
}

function e(id: string, kind: REdge['kind'], source: string, target: string): REdge {
  return { id, sessionId: SESSION_ID, kind, source, target };
}

const chunk1 = n(
  'fx-chunk-1',
  'chunk',
  1,
  spinePosition(0),
  '## 複利とは\n\nお金を預けると利子がつく。**複利**では、その利子にもまた利子がつく。\n\n元本だけに利子がつく「単利」との違いが、時間とともに雪だるま式に膨らむ。',
);

const chunk2md =
  '## 72の法則\n\n資産が2倍になるまでの年数は、おおよそ **72 ÷ 年利(%)** で見積もれる。\n\n年利6%なら約12年で2倍になる。これは指数関数の性質から導かれる近似だ。';
const chunk2 = n('fx-chunk-2', 'chunk', 2, spinePosition(1), chunk2md);

const chunk3 = n(
  'fx-chunk-3',
  'chunk',
  3,
  spinePosition(2),
  '## 積立の効果\n\n毎月一定額を積み立てると、早い時期の積立ほど長く複利が効く。\n\nつまり「いつ始めるか」が「いくら積むか」と同じくらい効いてくる。',
);

const chunk4 = n(
  'fx-chunk-4',
  'chunk',
  4,
  spinePosition(3),
  '## まとめ\n\n- 複利は利子に利子がつく仕組み\n- 72の法則で倍増年数をざっくり見積もれる\n- 積立は開始時期が重要\n\nここまでで基礎はおさえた。',
);

// なんで？ branch anchored to "指数関数の性質" inside chunk 2.
const anchorText = '指数関数の性質から導かれる近似';
const anchorStart = chunk2md.indexOf(anchorText);

const question1 = n(
  'fx-q-1',
  'question',
  5,
  branchPosition(chunk2, 1, 0),
  `> ${anchorText}\n\nwhy is this the case?`,
);

const answer1md =
  '2倍になる条件は (1+r)^t = 2。両辺の対数を取ると t = ln2 / ln(1+r) ≒ 0.693/r。\n\nパーセント表記に直すと 69.3 ÷ 年利(%)。**割り切りやすい72** が実用上使われている。';
const answer1 = n('fx-a-1', 'answer', 6, answerPosition(question1), answer1md);

// Recursive branch: なんで？ on the answer itself.
const anchor2Text = '割り切りやすい72';
const question2 = n(
  'fx-q-2',
  'question',
  7,
  branchPosition(answer1, 2, 0),
  `> ${anchor2Text}\n\nなんで69.3ではなく72を使うの？`,
);

const answer2 = n(
  'fx-a-2',
  'answer',
  8,
  answerPosition(question2),
  '72は 2, 3, 4, 6, 8, 9, 12 で割り切れる。暗算での見積もりが目的なので、精度より扱いやすさを優先している。',
);

chunk2.content.highlights.push({
  id: 'fx-hl-1',
  start: anchorStart,
  end: anchorStart + anchorText.length,
  text: anchorText,
  childNodeId: question1.id,
});

answer1.content.highlights.push({
  id: 'fx-hl-2',
  start: answer1md.indexOf(anchor2Text),
  end: answer1md.indexOf(anchor2Text) + anchor2Text.length,
  text: anchor2Text,
  childNodeId: question2.id,
});

// Interactive spine step: touch the curves the lesson described.
const playground1: RNode = {
  ...n(
    'fx-pg-1',
    'playground',
    9,
    spinePosition(4),
    '## 触ってみよう\n\n年利と期間を動かして、複利と単利の差がどう開くか確かめよう。',
  ),
  playground: { key: 'compound-curve', params: { rate: 6, years: 30 } },
};

const session: Session = {
  id: SESSION_ID,
  title: '複利のきほん',
  mode: 'learn',
  createdAt: 0,
  seqCounter: 9,
};

export const fixture: SessionExport = {
  schemaVersion: 1,
  session,
  nodes: [chunk1, chunk2, chunk3, chunk4, question1, answer1, question2, answer2, playground1],
  edges: [
    e('fx-e-1', 'next', chunk1.id, chunk2.id),
    e('fx-e-2', 'next', chunk2.id, chunk3.id),
    e('fx-e-3', 'next', chunk3.id, chunk4.id),
    e('fx-e-8', 'next', chunk4.id, playground1.id),
    e('fx-e-4', 'why', chunk2.id, question1.id),
    e('fx-e-5', 'reply', question1.id, answer1.id),
    e('fx-e-6', 'why', answer1.id, question2.id),
    e('fx-e-7', 'reply', question2.id, answer2.id),
  ],
};
