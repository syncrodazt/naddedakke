import type {
  AnswerRequest,
  GoalPlanRequest,
  LessonChunkRequest,
  LessonPlanRequest,
  TeachService,
  TranslateRequest,
  ConceptMapRequest,
} from './types';

const CANNED: { keywords: string[]; md: string }[] = [
  {
    keywords: ['72', '対数', 'log', 'ln'],
    md:
      '倍増条件は $(1+r)^t = 2$ です。両辺の自然対数を取ると\n\n' +
      '$$t = \\frac{\\ln 2}{\\ln(1+r)} \\approx \\frac{0.693}{r}$$\n\n' +
      'つまり **69.3 ÷ 年利(%)** が理論値で、実務では割りやすい 72 が使われます。',
  },
  {
    keywords: ['複利', 'compound', '利子'],
    md:
      'ポイントは **利子が元本に組み込まれる** ことです。\n\n' +
      '1. 1年目: 元本 × (1+r)\n' +
      '2. 2年目: その全体にまた (1+r)\n' +
      '3. n年目: 元本 × (1+r)^n\n\n' +
      '掛け算の繰り返しなので、増え方は直線ではなく指数カーブになります。',
  },
  {
    keywords: ['積立', '開始', 'いつ'],
    md:
      '早く始めた1万円は、遅く始めた1万円より **長く複利にさらされる** からです。\n\n' +
      '同じ金額でも投入タイミングが早いほど (1+r)^n の n が大きくなります。',
  },
  {
    keywords: [],
    md:
      'これは第一原理から考えると分かりやすいです。\n\n' +
      'まず定義に立ち返ると、問題の量は他の量の積み重ねで決まります。' +
      '一段ずつ分解して、それぞれの依存関係を追いかけてみましょう。' +
      '（これはモック回答です — 本物のClaude接続はマイルストーン4で入ります。）',
  },
];

let roundRobin = 0;

function pickAnswer(req: AnswerRequest): string {
  if (req.intent === 'respond') {
    return (
      `なるほど、「${req.question}」という答えですね。よい着眼点です。\n\n` +
      'これはモックのフィードバックです。本物のフィードバックは ' +
      '`.env.local` に `ANTHROPIC_API_KEY`（または `GEMINI_API_KEY`）を設定すると生成されます。'
    );
  }
  const haystack = `${req.quotedText} ${req.question}`.toLowerCase();
  for (const c of CANNED) {
    if (c.keywords.some((k) => haystack.includes(k.toLowerCase()))) return c.md;
  }
  const fallbacks = CANNED.filter((c) => c.keywords.length === 0);
  const pick = fallbacks[roundRobin % fallbacks.length] ?? CANNED[CANNED.length - 1]!;
  roundRobin++;
  return pick.md;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MOCK_LESSON_CHUNKS = 3;

/** A plan the same length as the mock lesson, so the two agree offline. */
const MOCK_PLAN_STEPS = MOCK_LESSON_CHUNKS;

/** Canned answers streamed in small tokens so the UI exercises real streaming. */
export class MockClaudeService implements TeachService {
  /**
   * Deliberately empty.
   *
   * Every other mock here stands in for real output so the app can be used
   * offline. This one must not: the entire point of a source is that it is a
   * real place you can go and check, and canned links dressed up as findings
   * would be the precise lie the feature exists to prevent. With no key there
   * is nothing to search, and saying so is the honest answer.
   */
  async findSources(): Promise<{ raw: string; searched: boolean }> {
    await delay(200);
    return { raw: JSON.stringify({ sources: [] }), searched: false };
  }

  // The same shape a real provider is asked for, so the plan panel and the
  // step-by-step teaching flow work with no API key configured.
  async planLesson(req: LessonPlanRequest): Promise<string> {
    await delay(300);
    return JSON.stringify({
      steps: Array.from({ length: MOCK_PLAN_STEPS }, (_, i) => ({
        title: `${req.topic} — ステップ${i + 1}（モック）`,
        gist: `モックの計画です。実際の計画は API キーを設定すると生成されます。`,
      })),
    });
  }

  async *streamAnswer(req: AnswerRequest): AsyncGenerator<string> {
    const md = pickAnswer(req);
    const tokens = md.match(/\S+\s*/g) ?? [md];
    for (const token of tokens) {
      if (req.signal?.aborted) return;
      await delay(30 + Math.random() * 30);
      yield token;
    }
  }

  // Emits the same JSON envelope a real provider is asked for, so the streaming
  // parser and the check-question composition are exercised offline too.
  async *streamLessonChunk(req: LessonChunkRequest): AsyncGenerator<string> {
    const n = (req.plan ? req.plan.stepIndex : req.chunkIndex) + 1;
    const total = req.plan ? req.plan.steps.length : MOCK_LESSON_CHUNKS;
    const payload = JSON.stringify({
      chunkTitle: `${req.topic} — その${n}`,
      md:
        `## ${req.topic} — その${n}\n\n` +
        `これはモックのレッスンチャンク${n}です。本物のレッスンは ` +
        `\`.env.local\` に \`ANTHROPIC_API_KEY\`（または \`GEMINI_API_KEY\`）を` +
        `設定すると生成されます。`,
      checkQuestion: `このチャンク${n}の要点を一言で言うと？`,
      done: n >= total,
    });
    // Arbitrary split points: the parser must not care where deltas land.
    for (let i = 0; i < payload.length; i += 12) {
      if (req.signal?.aborted) return;
      await delay(20 + Math.random() * 20);
      yield payload.slice(i, i + 12);
    }
  }

  // A small but genuinely solvable back-cast, so the review dialog and the
  // dataflow engine can be exercised with no API key configured.
  async decomposeGoal(req: GoalPlanRequest): Promise<string> {
    await delay(400);
    return JSON.stringify({
      title: `${req.goal}（モック）`,
      goalLabel: req.goal,
      goalNote:
        'これはモックの逆算プランです。本物は ANTHROPIC_API_KEY（または GEMINI_API_KEY）を設定すると生成されます。',
      variables: [
        {
          name: 'target_amount',
          label: '目標金額',
          value: 1000,
          unit: '万円',
          min: 100,
          max: 10000,
          step: 100,
        },
        { name: 'years_left', label: '残り年数', value: 10, unit: '年', min: 1, max: 40, step: 1 },
        {
          name: 'return_pct',
          label: '期待リターン',
          value: 4,
          unit: '%',
          min: 0,
          max: 10,
          step: 1,
        },
      ],
      derived: [
        {
          name: 'growth_factor',
          label: '複利の伸び',
          formula: '(1 + return_pct / 100) ^ years_left',
          unit: '倍',
          note: '元本が何倍になるか。',
        },
        {
          name: 'monthly_saving',
          label: '必要な毎月の積立',
          formula: 'target_amount / growth_factor / (years_left * 12)',
          unit: '万円/月',
          note: '目標から逆算した概算。',
        },
      ],
      goalOf: 'monthly_saving',
    });
  }

  // A tiny but genuinely acyclic map, so the ranking, the readiness gate and
  // the list can all be exercised with no API key configured. The first concept
  // is claimed by the learner's first notebook, so "known" has something to
  // mean and the gate is actually visible.
  async suggestConcepts(req: ConceptMapRequest): Promise<string> {
    await delay(500);
    const first = req.inventory[0]?.id;
    return JSON.stringify({
      concepts: [
        {
          id: 'mock-foundation',
          name: 'モックの土台',
          area: 'モック領域A',
          blurb: 'これはモックの概念マップです。',
          prereqs: [],
          sessionIds: first ? [first] : [],
          why: 'あなたの最初のノートが扱っています。',
        },
        {
          id: 'mock-next',
          name: 'モックの次の一歩',
          area: 'モック領域A',
          blurb: 'ANTHROPIC_API_KEY（または GEMINI_API_KEY）を設定すると本物が生成されます。',
          prereqs: ['mock-foundation'],
          sessionIds: [],
          why: '土台の上に直接積み上がります。',
        },
        {
          id: 'mock-later',
          name: 'モックのその先',
          area: 'モック領域B',
          blurb: 'まだ手が届かない概念の例です。',
          prereqs: ['mock-next'],
          sessionIds: [],
          why: '次の一歩を理解すると開きます。',
          // Crosses areas, so the cross-domain link is exercised offline too.
          sameAs: [{ id: 'mock-foundation', how: 'どちらも同じ構造のモック例です。' }],
        },
      ],
    });
  }

  // Not a translation — nothing offline can translate. It marks the body and
  // returns every quote unchanged, which is exactly what the re-anchoring path
  // needs to be exercised: the quotes still occur verbatim in the returned md,
  // so highlights must survive the round trip with no API key configured.
  async translate(req: TranslateRequest): Promise<string> {
    await delay(300);
    return JSON.stringify({
      items: req.items.map((item) => ({
        id: item.id,
        sourceLang: 'ja',
        md: `*（モック翻訳 → ${req.targetLabel}）*\n\n${item.md}`,
        quotes: item.quotes.map((q) => ({ id: q.id, text: q.text })),
      })),
    });
  }
}
