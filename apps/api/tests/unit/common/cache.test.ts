import { describe, expect, test } from 'bun:test';
import {
  CACHE_ACTIVE, CACHE_COMPLETED, CACHE_QUIET,
  cacheControlForActive, cacheControlForStatus, cacheControlForYear, cacheIfData, isIngestWindow,
  isWriteWindow, snapshotFreshUntil,
} from '../../../src/common/cache';

const WEDNESDAY = new Date('2026-06-17T12:00:00Z');
const SATURDAY = new Date('2026-06-20T12:00:00Z');

describe('isIngestWindow', () => {
  test.each([
    ['Thursday night', '2026-06-18T23:59:00Z', false],
    ['Friday morning', '2026-06-19T00:00:00Z', true],
    ['Sunday night', '2026-06-21T23:00:00Z', true],
    ['Monday morning', '2026-06-22T11:59:00Z', true],
    ['Monday noon', '2026-06-22T12:00:00Z', false],
  ])('%s → %p', (_, iso, expected) => {
    expect(isIngestWindow(new Date(iso))).toBe(expected);
  });
});

describe('cacheControlForActive', () => {
  test('a race weekend gets the short active cache', () => {
    expect(cacheControlForActive(SATURDAY)).toBe(CACHE_ACTIVE);
  });

  test('between race weekends it gets the hour-long quiet cache', () => {
    expect(cacheControlForActive(WEDNESDAY)).toBe(CACHE_QUIET);
  });
});

describe('cacheControlForStatus', () => {
  test('completed races get the long immutable cache', () => {
    expect(cacheControlForStatus('completed', SATURDAY)).toBe(CACHE_COMPLETED);
  });

  test('every other status follows the active cache', () => {
    for (const status of ['scheduled', 'qualifying_done', 'sprint_done', 'sprint_qualifying_done']) {
      expect(cacheControlForStatus(status, SATURDAY)).toBe(CACHE_ACTIVE);
      expect(cacheControlForStatus(status, WEDNESDAY)).toBe(CACHE_QUIET);
    }
  });
});

describe('cacheControlForYear', () => {
  test('a fully past season gets the long immutable cache', () => {
    expect(cacheControlForYear(2025, SATURDAY)).toBe(CACHE_COMPLETED);
  });

  test('the current season follows the active cache', () => {
    expect(cacheControlForYear(2026, SATURDAY)).toBe(CACHE_ACTIVE);
    expect(cacheControlForYear(2026, WEDNESDAY)).toBe(CACHE_QUIET);
  });

  test('a future year follows the active cache', () => {
    expect(cacheControlForYear(2027, SATURDAY)).toBe(CACHE_ACTIVE);
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

describe('isWriteWindow', () => {
  test.each([
    ['Thursday night', '2026-06-18T23:59:00Z', false],
    ['Friday morning', '2026-06-19T00:00:00Z', true],
    ['Monday evening, 24 h after a late Sunday race', '2026-06-22T23:59:00Z', true],
    ['Tuesday', '2026-06-23T00:00:00Z', false],
    ['Wednesday before the F1DB import', '2026-06-24T05:59:00Z', false],
    ['Wednesday during the F1DB import', '2026-06-24T06:00:00Z', true],
    ['Wednesday after a late-starting import', '2026-06-24T09:00:00Z', false],
  ])('%s → %p', (_, iso, expected) => {
    expect(isWriteWindow(new Date(iso))).toBe(expected);
  });
});

describe('snapshotFreshUntil', () => {
  const at = (iso: string) => new Date(iso);
  const plus = (iso: string, seconds: number) => Date.parse(iso) + seconds * 1000;

  test('between write windows a copy is held until the next one opens', () => {
    expect(snapshotFreshUntil(CACHE_QUIET, at('2026-06-16T12:00:00Z'))).toBe(Date.parse('2026-06-17T06:00:00Z'));
    expect(snapshotFreshUntil(CACHE_QUIET, at('2026-06-17T12:00:00Z'))).toBe(Date.parse('2026-06-19T00:00:00Z'));
  });

  test('a hold never ends before the max-age', () => {
    expect(snapshotFreshUntil(CACHE_QUIET, at('2026-06-18T23:30:00Z'))).toBe(plus('2026-06-18T23:30:00Z', 3600));
  });

  test('inside a write window a copy lasts only its max-age', () => {
    expect(snapshotFreshUntil(CACHE_ACTIVE, at('2026-06-20T12:00:00Z'))).toBe(plus('2026-06-20T12:00:00Z', 600));
    expect(snapshotFreshUntil(CACHE_QUIET, at('2026-06-17T07:00:00Z'))).toBe(plus('2026-06-17T07:00:00Z', 3600));
  });

  test('a completed answer written between write windows never expires', () => {
    expect(snapshotFreshUntil(CACHE_COMPLETED, at('2026-06-16T12:00:00Z'))).toBe(Infinity);
  });

  test('a completed answer written during a race weekend lasts its max-age, in case the weekend amends it', () => {
    expect(snapshotFreshUntil(CACHE_COMPLETED, at('2026-06-21T18:00:00Z'))).toBe(plus('2026-06-21T18:00:00Z', 86400));
  });
});
