import { describe, expect, test } from 'vitest';
import {
  barPercent, describeChase, formatMonthDay, formatRate, formatYearRange, lineageTotals, parseMonthDay, recordHolders,
  shiftMonthDay, timelineSpan, yearsAgoLabel,
} from '../../../../src/features/history/historyView';
import type { LineageMember, RecordEntry } from '../../../../src/types';

const entry = (name: string, value: number): RecordEntry => ({ f1dbId: name, name, value, nationality: null, coreId: null, active: false });
const member = (f1dbId: string, yearFrom: number, yearTo: number | null, raceWins = 0, championships = 0): LineageMember => ({
  f1dbId, name: f1dbId, yearFrom, yearTo, raceWins, championships, coreId: null,
});

describe('barPercent', () => {
  test('scales to the leader and keeps a visible sliver for small values', () => {
    expect(barPercent(53, 106)).toBe(50);
    expect(barPercent(1, 1000)).toBe(2);
    expect(barPercent(0, 10)).toBe(0);
  });
});

describe('recordHolders', () => {
  test('returns every entry tied on the top value', () => {
    expect(recordHolders([entry('Hamilton', 7), entry('Schumacher', 7), entry('Fangio', 5)]).map((e) => e.name))
      .toEqual(['Hamilton', 'Schumacher']);
  });
});

describe('formatRate', () => {
  test('renders a ratio as a one-decimal percentage', () => {
    expect(formatRate(0.4706)).toBe('47.1%');
  });
});

describe('describeChase', () => {
  test('counts what the chaser needs to match and to pass', () => {
    const view = describeChase({ stat: 'wins', record: entry('Hamilton', 106), chaser: entry('Verstappen', 72) });
    expect(view?.summary).toBe('34 wins to match · 35 to pass');
    expect(view?.progress).toBeCloseTo(72 / 106);
  });

  test('returns null when nobody is chasing', () => {
    expect(describeChase({ stat: 'wins', record: entry('Hamilton', 106), chaser: null })).toBeNull();
  });
});

describe('month-day helpers', () => {
  test('accepts only real calendar days, including 29 February', () => {
    expect(parseMonthDay('02-29')).toBe('02-29');
    expect(parseMonthDay('02-30')).toBeNull();
    expect(parseMonthDay('1-5')).toBeNull();
    expect(parseMonthDay(null)).toBeNull();
  });

  test('steps across month and year boundaries', () => {
    expect(shiftMonthDay('02-28', 1)).toBe('02-29');
    expect(shiftMonthDay('12-31', 1)).toBe('01-01');
    expect(shiftMonthDay('01-01', -1)).toBe('12-31');
  });

  test('formats as day and month', () => {
    expect(formatMonthDay('10-11')).toBe('11 October');
  });
});

describe('yearsAgoLabel', () => {
  test('reads naturally for this year, one year and many', () => {
    expect(yearsAgoLabel(2026, 2026)).toBe('this year');
    expect(yearsAgoLabel(2025, 2026)).toBe('1 year ago');
    expect(yearsAgoLabel(2015, 2026)).toBe('11 years ago');
  });
});

describe('lineage helpers', () => {
  test('places a member on the timeline and runs an open-ended one to the end year', () => {
    expect(timelineSpan(member('a', 1970, 1979), 1970, 2009)).toEqual({ left: 0, width: 25 });
    expect(timelineSpan(member('b', 2000, null), 1970, 2009)).toEqual({ left: 75, width: 25 });
  });

  test('counts a constructor that appears twice in a family once', () => {
    const renault = member('renault', 2002, 2011, 35, 2);
    expect(lineageTotals([member('benetton', 1986, 2001, 27, 1), renault, { ...renault, yearFrom: 2016, yearTo: 2020 }]))
      .toEqual({ wins: 62, titles: 3 });
  });

  test('formats single years, ranges and current names', () => {
    expect(formatYearRange(member('brawn', 2009, 2009))).toBe('2009');
    expect(formatYearRange(member('bar', 1999, 2005))).toBe('1999–2005');
    expect(formatYearRange(member('mercedes', 2010, null))).toBe('2010–');
  });
});
