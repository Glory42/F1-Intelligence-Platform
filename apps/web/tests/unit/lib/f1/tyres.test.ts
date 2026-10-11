import { describe, expect, it } from 'vitest';
import { compoundToken } from '@/lib/f1/tyres';

describe('compoundToken', () => {
  it('maps FastF1 and OpenF1 compound spellings to the same tyre token', () => {
    expect(compoundToken('SOFT')).toBe('tyre-soft');
    expect(compoundToken('soft')).toBe('tyre-soft');
    expect(compoundToken('MEDIUM')).toBe('tyre-medium');
    expect(compoundToken('HARD')).toBe('tyre-hard');
    expect(compoundToken('INTERMEDIATE')).toBe('tyre-inter');
    expect(compoundToken('WET')).toBe('tyre-wet');
  });

  it("uses 2018's named compounds and colours for that season only", () => {
    expect(compoundToken('ULTRASOFT', 2018)).toBe('tyre-ultrasoft');
    expect(compoundToken('SOFT', 2018)).toBe('tyre-medium');
    expect(compoundToken('HARD', 2018)).toBe('tyre-icehard');
    expect(compoundToken('SOFT', 2019)).toBe('tyre-soft');
    expect(compoundToken('INTERMEDIATE', 2018)).toBe('tyre-inter');
  });

  it('falls back to the neutral token for unknown or missing compounds', () => {
    expect(compoundToken('UNKNOWN')).toBe('tyre-unknown');
    expect(compoundToken('TEST_UNKNOWN')).toBe('tyre-unknown');
    expect(compoundToken(null)).toBe('tyre-unknown');
  });
});
