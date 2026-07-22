// Pure math for the compound-interest playground — kept separate so it's
// trivially unit-testable without a canvas.

export type CompoundParams = { rate: number; years: number };

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
