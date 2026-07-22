import { describe, expect, it } from 'vitest';
import { compoundAt, doublingYears, simpleAt, verdict } from './compound';

describe('compound playground math', () => {
  it('compound grows multiplicatively, simple linearly', () => {
    expect(compoundAt(10, 0)).toBe(1);
    expect(compoundAt(10, 2)).toBeCloseTo(1.21);
    expect(simpleAt(10, 2)).toBeCloseTo(1.2);
  });

  it('doubling years matches the rule-of-72 ballpark', () => {
    const exact = doublingYears(6);
    expect(exact).toBeGreaterThan(11);
    expect(exact).toBeLessThan(13);
    expect(compoundAt(6, exact)).toBeCloseTo(2);
  });

  it('verdict states doubling years and the compound/simple gap', () => {
    const line = verdict({ rate: 6, years: 30 });
    expect(line).toContain('年利6%');
    expect(line).toContain('2倍');
    expect(line).toContain('30年');
  });
});
