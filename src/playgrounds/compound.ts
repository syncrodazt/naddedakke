// Pure math and config for the compound-interest playground — kept separate
// from the component so it's unit-testable and fast-refresh stays happy.
import type { SliderSpec } from './SliderCanvas';

export type CompoundParams = { rate: number; years: number };

export const compoundCurveSliders: SliderSpec[] = [
  { key: 'rate', label: '年利', min: 1, max: 15, step: 0.5, unit: '%' },
  { key: 'years', label: '期間', min: 5, max: 50, step: 1, unit: '年' },
];

export const compoundCurveDefaults = { rate: 6, years: 30 };

export function compoundAt(rate: number, t: number): number {
  return Math.pow(1 + rate / 100, t);
}

export function simpleAt(rate: number, t: number): number {
  return 1 + (rate / 100) * t;
}

/** Years for capital to double at `rate` % — exact, not the 72 approximation. */
export function doublingYears(rate: number): number {
  return Math.log(2) / Math.log(1 + rate / 100);
}

export function verdict({ rate, years }: CompoundParams): string {
  const dbl = doublingYears(rate);
  const ratio = compoundAt(rate, years) / simpleAt(rate, years);
  return (
    `年利${rate}%だと約${dbl.toFixed(1)}年で資産が2倍（72の法則: 72÷${rate} ≒ ` +
    `${(72 / rate).toFixed(1)}年）。${years}年後、複利は単利の約${ratio.toFixed(2)}倍。`
  );
}
