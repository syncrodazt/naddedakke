import type { REdge, RNode, Session, SessionExport } from '../model/types';

// FIRE-by-35 back-cast demo. Node ids double as mathjs variable names, so
// they use underscores. All money figures in 万円.

const SESSION_ID = 'fire-fixture';

type Pos = { x: number; y: number };

function base(id: string, kind: RNode['kind'], seq: number, position: Pos, md: string): RNode {
  return { id, sessionId: SESSION_ID, kind, seq, position, content: { md, highlights: [] } };
}

function variable(
  id: string,
  seq: number,
  position: Pos,
  md: string,
  value: number,
  unit: string,
  varInput: { min: number; max: number; step: number },
): RNode {
  return { ...base(id, 'variable', seq, position, md), value, unit, varInput };
}

function derived(
  id: string,
  seq: number,
  position: Pos,
  md: string,
  formula: string,
  unit: string,
): RNode {
  return { ...base(id, 'derived', seq, position, md), formula, unit };
}

function e(id: string, kind: REdge['kind'], source: string, target: string): REdge {
  return { id, sessionId: SESSION_ID, kind, source, target };
}

const COL = { vars: 0, mid: 460, right: 920 };
const ROW = 210;

const current_age = variable('current_age', 1, { x: COL.vars, y: 0 }, '**現在の年齢**', 28, '歳', {
  min: 20,
  max: 34,
  step: 1,
});
const target_age = variable(
  'target_age',
  2,
  { x: COL.vars, y: ROW },
  '**FIRE目標年齢**',
  35,
  '歳',
  { min: 30, max: 50, step: 1 },
);
const net_worth = variable(
  'net_worth',
  3,
  { x: COL.vars, y: ROW * 2 },
  '**現在の純資産**',
  300,
  '万円',
  { min: 0, max: 5000, step: 50 },
);
const annual_expenses = variable(
  'annual_expenses',
  4,
  { x: COL.vars, y: ROW * 3 },
  '**FIRE後の年間支出**',
  300,
  '万円/年',
  { min: 100, max: 1000, step: 10 },
);
const return_pct = variable(
  'return_pct',
  5,
  { x: COL.vars, y: ROW * 4 },
  '**期待リターン（年率）**',
  4,
  '%',
  { min: 0.5, max: 10, step: 0.5 },
);
const withdraw_pct = variable(
  'withdraw_pct',
  6,
  { x: COL.vars, y: ROW * 5 },
  '**取り崩し率**\n\n4%ルールが定番。',
  4,
  '%',
  { min: 2, max: 6, step: 0.25 },
);

const years_left = derived(
  'years_left',
  7,
  { x: COL.mid, y: ROW * 0.5 },
  '**残り年数**',
  'target_age - current_age',
  '年',
);
const required_portfolio = derived(
  'required_portfolio',
  8,
  { x: COL.mid, y: ROW * 3.5 },
  '**必要ポートフォリオ**\n\n年間支出 ÷ 取り崩し率。',
  'annual_expenses / (withdraw_pct / 100)',
  '万円',
);
const future_net_worth = derived(
  'future_net_worth',
  9,
  { x: COL.mid, y: ROW * 2 },
  '**現資産の将来価値**\n\n今の資産が目標年齢まで複利で育った分。',
  'net_worth * (1 + return_pct / 100) ^ years_left',
  '万円',
);
const required_monthly = derived(
  'required_monthly',
  10,
  { x: COL.right, y: ROW * 2.2 },
  '**必要な毎月の積立**\n\n不足分を残り年数の積立（複利）で埋める。',
  'max(0, (required_portfolio - future_net_worth) * (return_pct / 100 / 12) / ((1 + return_pct / 100 / 12) ^ (12 * years_left) - 1))',
  '万円/月',
);

const fire_goal = base(
  'fire_goal',
  'goal',
  11,
  { x: COL.right, y: ROW * 0.5 },
  '# 35歳でFIRE\n\n必要ポートフォリオを目標年齢までに積み上げる。',
);

const disclaimer = base(
  'disclaimer',
  'chunk',
  12,
  { x: COL.vars, y: ROW * 6 },
  '⚠️ これは教育用の簡易モデルです。税金・インフレ・変動リスクは無視しています。投資助言ではありません。',
);

const session: Session = {
  id: SESSION_ID,
  title: 'FIRE 逆算デモ',
  mode: 'gyakusan',
  createdAt: 1,
  seqCounter: 12,
};

export const fireFixture: SessionExport = {
  schemaVersion: 1,
  session,
  nodes: [
    current_age,
    target_age,
    net_worth,
    annual_expenses,
    return_pct,
    withdraw_pct,
    years_left,
    required_portfolio,
    future_net_worth,
    required_monthly,
    fire_goal,
    disclaimer,
  ],
  edges: [
    e('fe-1', 'depends', 'current_age', 'years_left'),
    e('fe-2', 'depends', 'target_age', 'years_left'),
    e('fe-3', 'depends', 'annual_expenses', 'required_portfolio'),
    e('fe-4', 'depends', 'withdraw_pct', 'required_portfolio'),
    e('fe-5', 'depends', 'net_worth', 'future_net_worth'),
    e('fe-6', 'depends', 'return_pct', 'future_net_worth'),
    e('fe-7', 'depends', 'years_left', 'future_net_worth'),
    e('fe-8', 'depends', 'required_portfolio', 'required_monthly'),
    e('fe-9', 'depends', 'future_net_worth', 'required_monthly'),
    e('fe-10', 'depends', 'return_pct', 'required_monthly'),
    e('fe-11', 'depends', 'years_left', 'required_monthly'),
    e('fe-12', 'depends', 'required_monthly', 'fire_goal'),
  ],
};
