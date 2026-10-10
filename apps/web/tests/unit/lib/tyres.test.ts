import { describe, expect, it } from 'vitest';
import { compoundToken } from '@/lib/tyres';

describe('compoundToken', () => {
  it('maps FastF1 and OpenF1 compound spellings to the same tyre token', () => {
    expect(compoundToken('SOFT')).toBe('tyre-soft');
    expect(compoundToken('soft')).toBe('tyre-soft');
    expect(compoundToken('MEDIUM')).toBe('tyre-medium');
    expect(compoundToken('HARD')).toBe('tyre-hard');
    expect(compoundToken('INTERMEDIATE')).toBe('tyre-inter');
    expect(compoundToken('WET')).toBe('tyre-wet');
  });

  it('falls back to the neutral token for unknown or missing compounds', () => {
    expect(compoundToken('UNKNOWN')).toBe('tyre-unknown');
    expect(compoundToken('TEST_UNKNOWN')).toBe('tyre-unknown');
    expect(compoundToken(null)).toBe('tyre-unknown');
  });
});
