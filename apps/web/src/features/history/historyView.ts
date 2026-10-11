import type { DriverRecordStat, LineageMember, RecordChase, RecordEntry } from '@/types';
import { getTeamColor } from '@/lib/teamColors';

export const RANK_COLORS = ['#f5c542', '#c9d1db', '#cd7f32'] as const;

export const CHASE_LABELS: Record<DriverRecordStat, { title: string; unit: string }> = {
  wins: { title: 'Most race wins', unit: 'wins' },
  championships: { title: 'Most championships', unit: 'titles' },
  poles: { title: 'Most pole positions', unit: 'poles' },
  podiums: { title: 'Most podiums', unit: 'podiums' },
  starts: { title: 'Most race starts', unit: 'starts' },
};

// A sliver of bar stays visible even for a tiny share, so every row reads as a bar.
export function barPercent(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(2, Math.min(100, (value / max) * 100));
}

export function recordHolders(entries: RecordEntry[]): RecordEntry[] {
  const top = entries[0]?.value;
  return top == null ? [] : entries.filter((e) => e.value === top);
}

export function formatRate(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export type ChaseView = { gap: number; progress: number; summary: string };

export function describeChase(chase: RecordChase): ChaseView | null {
  if (!chase.chaser) return null;
  const { unit } = CHASE_LABELS[chase.stat];
  const gap = chase.record.value - chase.chaser.value;
  const progress = chase.record.value > 0 ? Math.min(1, chase.chaser.value / chase.record.value) : 0;
  const summary = gap <= 0 ? 'level with the record' : `${gap} ${unit} to match · ${gap + 1} to pass`;
  return { gap, progress, summary };
}

const MONTH_DAY = /^(\d{2})-(\d{2})$/;

// 2024 is a leap year, so 29 February is reachable.
function monthDayDate(monthDay: string): Date | null {
  const match = MONTH_DAY.exec(monthDay);
  if (!match) return null;
  const date = new Date(Date.UTC(2024, Number(match[1]) - 1, Number(match[2])));
  const roundTrips = date.getUTCMonth() === Number(match[1]) - 1 && date.getUTCDate() === Number(match[2]);
  return roundTrips ? date : null;
}

function toMonthDay(date: Date): string {
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function todayMonthDay(now: Date): string {
  return toMonthDay(now);
}

export function parseMonthDay(value: string | null): string | null {
  return value && monthDayDate(value) ? value : null;
}

export function shiftMonthDay(monthDay: string, days: number): string {
  const date = monthDayDate(monthDay) ?? new Date(Date.UTC(2024, 0, 1));
  date.setUTCDate(date.getUTCDate() + days);
  return toMonthDay(new Date(Date.UTC(2024, date.getUTCMonth(), date.getUTCDate())));
}

export function formatMonthDay(monthDay: string): string {
  const date = monthDayDate(monthDay);
  return date ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }) : monthDay;
}

export function yearsAgoLabel(year: number, currentYear: number): string {
  const years = currentYear - year;
  if (years <= 0) return 'this year';
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

export type TimelineSpan = { left: number; width: number };

export function timelineSpan(member: LineageMember, startYear: number, endYear: number): TimelineSpan {
  const total = endYear - startYear + 1;
  const from = Math.max(member.yearFrom, startYear);
  const to = Math.min(member.yearTo ?? endYear, endYear);
  return { left: ((from - startYear) / total) * 100, width: (Math.max(0, to - from + 1) / total) * 100 };
}

// F1DB totals are per constructor, so a name that appears twice (Renault, Sauber) counts once.
export function lineageTotals(members: LineageMember[]): { wins: number; titles: number } {
  const unique = new Map(members.map((m) => [m.f1dbId, m]));
  return [...unique.values()].reduce(
    (acc, m) => ({ wins: acc.wins + m.raceWins, titles: acc.titles + m.championships }),
    { wins: 0, titles: 0 },
  );
}

const MEMBER_COLOR_KEYS: Record<string, string> = { 'lotus-f1': 'lotus' };

export function lineageMemberColor(f1dbId: string): string {
  return getTeamColor(MEMBER_COLOR_KEYS[f1dbId] ?? f1dbId.replace(/-/g, '_'));
}

export function formatYearRange(member: LineageMember): string {
  if (member.yearTo == null) return `${member.yearFrom}–`;
  return member.yearTo === member.yearFrom ? String(member.yearFrom) : `${member.yearFrom}–${member.yearTo}`;
}
