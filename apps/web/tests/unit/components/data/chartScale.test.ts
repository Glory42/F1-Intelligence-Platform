import { describe, expect, it } from 'vitest';
import { linearScale, niceTicks } from '@/components/data/chartScale';

describe('linearScale', () => {
  it('maps a domain value proportionally into the range', () => {
    expect(linearScale([0, 100], [0, 500])(50)).toBe(250);
  });

  it('supports an inverted range for SVG y axes', () => {
    expect(linearScale([0, 100], [300, 0])(25)).toBe(225);
  });

  it('maps every value of a zero-width domain to the middle of the range', () => {
    expect(linearScale([7, 7], [0, 100])(7)).toBe(50);
  });
});

// Expected values match d3-array's ticks(), the de-facto reference for "nice" axis ticks.
describe('niceTicks', () => {
  it('picks round steps covering the domain', () => {
    expect(niceTicks(0, 87, 5)).toEqual([0, 20, 40, 60, 80]);
  });

  it('produces exact decimal ticks without float drift', () => {
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });

  it('spans negative to positive domains', () => {
    expect(niceTicks(-2.1, 4.4, 4)).toEqual([-2, 0, 2, 4]);
  });

  it('returns the single value for an empty domain', () => {
    expect(niceTicks(3, 3, 5)).toEqual([3]);
  });
});
