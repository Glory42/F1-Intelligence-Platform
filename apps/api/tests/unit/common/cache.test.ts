import { describe, expect, test } from 'bun:test';
import { CACHE_ACTIVE, CACHE_COMPLETED, cacheControlForStatus, cacheControlForYear, cacheIfData } from '../../../src/common/cache';

describe('cacheControlForStatus', () => {
  test('completed races get the long immutable cache', () => {
    expect(cacheControlForStatus('completed')).toBe(CACHE_COMPLETED);
  });

  test('every other status gets the short active cache', () => {
    for (const status of ['scheduled', 'qualifying_done', 'sprint_done', 'sprint_qualifying_done']) {
      expect(cacheControlForStatus(status)).toBe(CACHE_ACTIVE);
    }
  });
});

describe('cacheControlForYear', () => {
  const now = new Date('2026-06-15T00:00:00Z');

  test('a fully past season gets the long immutable cache', () => {
    expect(cacheControlForYear(2025, now)).toBe(CACHE_COMPLETED);
  });

  test('the current season gets the short active cache', () => {
    expect(cacheControlForYear(2026, now)).toBe(CACHE_ACTIVE);
  });

  test('a future year gets the short active cache', () => {
    expect(cacheControlForYear(2027, now)).toBe(CACHE_ACTIVE);
  });
});

describe('cacheIfData', () => {
  test('a response with data keeps the cache rule it was given', () => {
    expect(cacheIfData(CACHE_COMPLETED, true)).toBe(CACHE_COMPLETED);
  });

  test('an empty response is only cached briefly, so a later backfill or import shows up at once', () => {
    expect(cacheIfData(CACHE_COMPLETED, false)).toBe(CACHE_ACTIVE);
  });
});
