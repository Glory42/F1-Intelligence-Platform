import { describe, expect, it } from 'vitest';
import { isWriteWindow, pageHoldSeconds } from '@/lib/pageHold';

const HOUR = 3600;

describe('page hold', () => {
  it.each([
    ['Friday morning', '2026-06-19T00:00:00Z'],
    ['Sunday night', '2026-06-21T23:00:00Z'],
    ['Monday evening', '2026-06-22T20:00:00Z'],
    ['the Wednesday F1DB import', '2026-06-17T07:00:00Z'],
  ])('keeps a page 10 minutes inside a write window (%s)', (_label, iso) => {
    expect(isWriteWindow(new Date(iso))).toBe(true);
    expect(pageHoldSeconds(new Date(iso))).toBe(600);
  });

  it('holds a Tuesday page until midnight UTC, when today-dependent pages must change', () => {
    expect(pageHoldSeconds(new Date('2026-06-16T10:00:00Z'))).toBe(14 * HOUR);
  });

  it('holds a Wednesday-morning page until the F1DB import opens', () => {
    expect(pageHoldSeconds(new Date('2026-06-17T04:00:00Z'))).toBe(2 * HOUR);
  });

  it('holds a Thursday-night page until the race weekend opens', () => {
    expect(pageHoldSeconds(new Date('2026-06-18T22:30:00Z'))).toBe(1.5 * HOUR);
  });

  it('never hands out a hold shorter than a minute', () => {
    expect(pageHoldSeconds(new Date('2026-06-18T23:59:50Z'))).toBe(60);
  });
});
