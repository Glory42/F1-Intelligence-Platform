import { api } from '@/lib/api';
import { resolveTab } from '@/lib/pageTabs';
import { formatAgeFromDays } from '@/lib/utils';
import { formatRate, parseMonthDay, recordHolders, todayMonthDay } from './historyView';
import type { LeaderboardEntry, RecordHolder, RecordTileData } from './types';
import type {
  ConstructorLineage, DriverRecordStat, HistoryMilestones, HistoryRecords, MilestoneEntry, MilestoneKey, OnThisDay, RecordChase, RecordEntry,
} from '@/types';

export const HISTORY_TABS = [
  { id: 'records', label: 'Records' },
  { id: 'milestones', label: 'Milestones' },
  { id: 'on-this-day', label: 'On this day' },
  { id: 'lineage', label: 'Lineage' },
] as const;

export type HistoryTab = (typeof HISTORY_TABS)[number]['id'];

export interface RecordsView {
  headline: Record<'championships' | 'wins' | 'poles' | 'starts', RecordTileData>;
  chases: RecordChase[];
  drivers: Record<DriverRecordStat, LeaderboardEntry[]>;
  rates: Record<keyof HistoryRecords['rates'], LeaderboardEntry[]>;
  rateMinStarts: number;
  constructors: Record<keyof HistoryRecords['constructors'], LeaderboardEntry[]>;
}

export interface MilestonesView {
  headline: Record<'youngestWinner' | 'youngestPole' | 'oldestFirstWin', RecordTileData | null>;
  rows: Record<MilestoneKey, LeaderboardEntry[]>;
}

const TITLES: Record<HistoryTab, string> = {
  'records': 'All-time records',
  'milestones': 'Milestones',
  'on-this-day': 'On this day',
  'lineage': 'Team lineage',
};

export interface HistoryPageData {
  tab: HistoryTab;
  title: string;
  records: RecordsView | null;
  milestones: MilestonesView | null;
  onThisDay: OnThisDay | null;
  requestedDay: string;
  currentYear: number;
  lineages: ConstructorLineage[];
  lineageStart: number;
}

const driverHref = (e: { coreId: number | null }) => (e.coreId != null ? `/drivers/${e.coreId}` : undefined);

function driverRows(rows: RecordEntry[], display?: (v: number) => string): LeaderboardEntry[] {
  return rows.map((r) => ({
    name: r.name, value: r.value, display: display?.(r.value), nationality: r.nationality, href: driverHref(r), active: r.active,
  }));
}

function constructorRows(rows: RecordEntry[]): LeaderboardEntry[] {
  return rows.map((r) => ({
    name: r.name, value: r.value, nationality: r.nationality, href: r.coreId != null ? `/teams/${r.coreId}` : undefined, active: r.active,
  }));
}

function holder(e: RecordEntry | MilestoneEntry): RecordHolder {
  return { name: e.name, nationality: e.nationality, href: driverHref(e), active: e.active };
}

function topTile(rows: RecordEntry[], holders: RecordEntry[] = rows.slice(0, 1)): RecordTileData {
  return { value: String(rows[0]?.value ?? '-'), holders: holders.map(holder) };
}

function recordsView(records: HistoryRecords): RecordsView {
  const { drivers: d, rates, constructors: c } = records;
  return {
    headline: {
      championships: topTile(d.championships, recordHolders(d.championships)),
      wins: topTile(d.wins), poles: topTile(d.poles), starts: topTile(d.starts),
    },
    chases: records.chases,
    drivers: {
      wins: driverRows(d.wins), championships: driverRows(d.championships), poles: driverRows(d.poles),
      podiums: driverRows(d.podiums), starts: driverRows(d.starts),
    },
    rates: {
      winRate: driverRows(rates.winRate, formatRate), poleRate: driverRows(rates.poleRate, formatRate),
      podiumRate: driverRows(rates.podiumRate, formatRate),
    },
    rateMinStarts: records.rateMinStarts,
    constructors: { wins: constructorRows(c.wins), championships: constructorRows(c.championships), poles: constructorRows(c.poles) },
  };
}

function milestoneRows(rows: MilestoneEntry[]): LeaderboardEntry[] {
  return rows.map((r) => ({
    name: r.name, value: r.days, display: formatAgeFromDays(r.days), detail: r.raceName, nationality: r.nationality,
    href: driverHref(r), active: r.active,
  }));
}

function firstTile(rows: MilestoneEntry[]): RecordTileData | null {
  const first = rows[0];
  return first ? { value: formatAgeFromDays(first.days), holders: [holder(first)], detail: first.raceName } : null;
}

function milestonesView(m: HistoryMilestones): MilestonesView {
  return {
    headline: { youngestWinner: firstTile(m.youngestWinner), youngestPole: firstTile(m.youngestPole), oldestFirstWin: firstTile(m.oldestFirstWin) },
    rows: {
      youngestWinner: milestoneRows(m.youngestWinner), youngestPole: milestoneRows(m.youngestPole),
      youngestPodium: milestoneRows(m.youngestPodium), youngestStarter: milestoneRows(m.youngestStarter),
      oldestFirstWin: milestoneRows(m.oldestFirstWin), longestWaitForWin: milestoneRows(m.longestWaitForWin),
    },
  };
}

function lineageStartYear(lineages: ConstructorLineage[], currentYear: number): number {
  const earliest = Math.min(...lineages.flatMap((l) => l.members.map((m) => m.yearFrom)), currentYear);
  return Math.floor(earliest / 10) * 10;
}

export async function loadHistoryPageData(url: URL, now: Date = new Date()): Promise<HistoryPageData> {
  const tab = resolveTab(url, HISTORY_TABS);
  const requestedDay = parseMonthDay(url.searchParams.get('date')) ?? todayMonthDay(now);
  const currentYear = now.getUTCFullYear();
  const [records, milestones, onThisDay, lineages] = await Promise.all([
    tab === 'records' ? api.getHistoryRecords().then(recordsView, () => null) : null,
    tab === 'milestones' ? api.getHistoryMilestones().then(milestonesView, () => null) : null,
    tab === 'on-this-day' ? api.getOnThisDay(requestedDay).catch(() => null) : null,
    tab === 'lineage' ? api.getConstructorLineages().catch((): ConstructorLineage[] => []) : [],
  ]);
  return {
    tab, title: TITLES[tab], records, milestones, onThisDay, requestedDay, currentYear, lineages,
    lineageStart: lineageStartYear(lineages, currentYear),
  };
}

export const onThisDayHref = (monthDay: string): string => `/history?tab=on-this-day&date=${monthDay}`;
