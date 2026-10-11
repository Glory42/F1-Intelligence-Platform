import { describe, expect, test } from 'vitest';
import {
  calendarEntries, calendarQuery, calendarSummary, parseCalendarFilter, parseCalendarSort,
} from '../../../../src/features/races/calendar';
import type { Race } from '../../../../src/types';

const race = (id: number, hasSprint: boolean) =>
  ({ id, hasSprint, raceDate: `2025-0${id}-10`, sprintDate: hasSprint ? `2025-0${id}-09` : null }) as Race;

describe('calendarEntries', () => {
  const races = [race(1, false), race(2, true)];

  test('splits a sprint weekend into a sprint entry before its grand prix', () => {
    expect(calendarEntries(races, 'all', 'asc').map((e) => [e.href, e.date])).toEqual([
      ['/races/1', '2025-01-10'],
      ['/races/2/sprint', '2025-02-09'],
      ['/races/2', '2025-02-10'],
    ]);
  });

  test('filters to one session type and reverses for descending order', () => {
    expect(calendarEntries(races, 'sprint', 'asc').map((e) => e.href)).toEqual(['/races/2/sprint']);
    expect(calendarEntries(races, 'gp', 'desc').map((e) => e.href)).toEqual(['/races/2', '/races/1']);
  });
});

describe('calendar params', () => {
  test('falls back to defaults for unknown values and keeps defaults out of the URL', () => {
    expect([parseCalendarFilter('nope'), parseCalendarSort(null)]).toEqual(['all', 'asc']);
    expect(calendarQuery(2025, 'all', 'asc')).toBe('?year=2025');
    expect(calendarQuery(2025, 'sprint', 'desc')).toBe('?year=2025&filter=sprint&sort=desc');
  });

  test('counts sprint entries for the sprint filter and weekends otherwise', () => {
    const done = { races: 10, entries: 3 };
    const left = { races: 14, entries: 3 };
    expect(calendarSummary('sprint', done, left)).toBe('3 sprint completed · 3 remaining');
    expect(calendarSummary('gp', done, left)).toBe('10 GP completed · 14 remaining');
    expect(calendarSummary('all', done, left)).toBe('10 races completed · 14 remaining');
  });
});
