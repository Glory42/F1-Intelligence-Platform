import { describe, expect, it } from 'bun:test';
import { qualifyingGapMs } from '../../../../src/modules/drivers/qualifying-gap.helpers';

const lap = (q1: number | null, q2: number | null = null, q3: number | null = null) => ({ q1TimeMs: q1, q2TimeMs: q2, q3TimeMs: q3 });

describe('qualifyingGapMs', () => {
  it('compares the deepest session both drivers set a time in', () => {
    expect(qualifyingGapMs(lap(80_000, 79_500, 79_000), lap(80_100, 79_400, 79_250))).toBe(-250);
  });

  it('falls back to Q2 when only one of them reached Q3', () => {
    expect(qualifyingGapMs(lap(80_000, 79_500, 79_000), lap(80_100, 79_700))).toBe(-200);
  });

  it('has no gap when they never shared a session with a time', () => {
    expect(qualifyingGapMs(lap(null), lap(80_000))).toBeNull();
  });
});
