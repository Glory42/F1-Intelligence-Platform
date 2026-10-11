import { describe, expect, test } from 'vitest';
import { formatAgeFromDays, formatStopSeconds, unwrapSettled } from '../../../src/lib/utils';

describe('unwrapSettled', () => {
  test('returns the value when the settled result is fulfilled', () => {
    const result: PromiseSettledResult<number> = { status: 'fulfilled', value: 42 };
    expect(unwrapSettled(result, 0)).toBe(42);
  });

  test('returns the fallback when the settled result is rejected', () => {
    const result: PromiseSettledResult<number> = { status: 'rejected', reason: new Error('boom') };
    expect(unwrapSettled(result, 0)).toBe(0);
  });

  test('works with array fallbacks', () => {
    const result: PromiseSettledResult<string[]> = { status: 'rejected', reason: new Error('boom') };
    expect(unwrapSettled(result, [])).toEqual([]);
  });
});

describe('formatStopSeconds', () => {
  test('formats a pit stop duration in seconds with two decimals', () => {
    expect(formatStopSeconds(2300)).toBe('2.30 s');
    expect(formatStopSeconds(24545)).toBe('24.55 s');
  });

  test('shows a dash when the duration is unknown', () => {
    expect(formatStopSeconds(null)).toBe('-');
  });
});

describe('formatAgeFromDays', () => {
  test('formats an age in days as years and days', () => {
    // Verstappen won the 2016 Spanish GP aged 18 years 228 days.
    expect(formatAgeFromDays(6802)).toBe('18 y 228 d');
  });
});
