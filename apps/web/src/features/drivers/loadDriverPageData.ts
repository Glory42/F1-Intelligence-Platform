import { api } from '@/lib/api';
import { resolveCareerYear, type YearLink } from '@/lib/careerYear';
import { getDriverFlagByCode, getNationalityFlag } from '@/lib/f1/countryFlags';
import { driverPredictionRecord, type DriverPredictionRecord } from '@/lib/f1/predictionMath';
import { resolveTab, seasonTabHref } from '@/lib/pageTabs';
import { unwrapSettled } from '@/lib/utils';
import type { DriverDetailResponse, DriverHistory, DriverYearStats, TeammateBattle } from '@/types';

export const DRIVER_TABS = [
  { id: 'season', label: 'This season' },
  { id: 'teammate', label: 'Teammate battle' },
  { id: 'career', label: 'Career' },
  { id: 'model', label: 'Model' },
] as const;

export type DriverTab = (typeof DRIVER_TABS)[number]['id'];

export interface DriverPageData {
  tab: DriverTab;
  year: number;
  yearLinks: YearLink[];
  error: string | null;
  career: DriverYearStats[];
  detail: DriverDetailResponse | null;
  headshotUrl: string | null;
  titles: number;
  nationalityFlag: string;
  teammateBattle: TeammateBattle | null;
  driverHistory: DriverHistory | null;
  predictionRecord: DriverPredictionRecord | null;
}

const NO_DRIVER = {
  detail: null, headshotUrl: null, titles: 0, nationalityFlag: '🏁',
  teammateBattle: null, driverHistory: null, predictionRecord: null,
} satisfies Partial<DriverPageData>;

export async function loadDriverPageData(url: URL, driverId: number, now: Date = new Date()): Promise<DriverPageData> {
  const tab = resolveTab(url, DRIVER_TABS);
  const requested = url.searchParams.get('year');
  const yearLinksOf = (career: DriverYearStats[]): YearLink[] =>
    career.map((y) => ({ year: y.year, href: seasonTabHref(url, DRIVER_TABS, tab, y.year, `/drivers/${y.driverId}`) }));
  const failed = (error: string, year: number, career: DriverYearStats[]): DriverPageData =>
    ({ ...NO_DRIVER, tab, year, error, career, yearLinks: yearLinksOf(career) });
  const fallbackYear = Number(requested ?? now.getFullYear());

  let career: DriverYearStats[];
  try {
    career = await api.getDriverCareer(driverId);
  } catch (e) {
    return failed(errorMessage(e), fallbackYear, []);
  }
  const year = resolveCareerYear(career.map((y) => y.year), requested ? Number(requested) : null, now.getFullYear());
  if (year == null) return failed('Driver has no career records', fallbackYear, career);

  // Driver ids are season-scoped, so per-season endpoints take the id that driver had that year.
  const seasonDriverId = career.find((y) => y.year === year)?.driverId ?? driverId;
  const [detailResult, battleResult, historyResult, tipsResult] = await Promise.allSettled([
    api.getDriverById(driverId, year),
    tab === 'teammate' ? api.getTeammateBattle(seasonDriverId, year) : Promise.resolve(null),
    tab === 'career' ? api.getDriverHistory(seasonDriverId) : Promise.resolve(null),
    tab === 'model' ? api.getPredictionHistory(year) : Promise.resolve(null),
  ]);
  if (detailResult.status === 'rejected') return failed(errorMessage(detailResult.reason), year, career);

  const detail = detailResult.value;
  const { driver } = detail;
  const tips = unwrapSettled(tipsResult, null);
  return {
    tab,
    year,
    yearLinks: yearLinksOf(career),
    error: null,
    career,
    detail,
    headshotUrl: driver.headshotUrl ?? career.find((y) => y.headshotUrl)?.headshotUrl ?? null,
    titles: career.filter((y) => y.year < now.getFullYear() && y.stats?.championshipPosition === 1).length,
    nationalityFlag: driver.nationality ? getNationalityFlag(driver.nationality) : getDriverFlagByCode(driver.code),
    teammateBattle: unwrapSettled(battleResult, null),
    driverHistory: unwrapSettled(historyResult, null),
    predictionRecord: tips ? driverPredictionRecord(tips, driverId) : null,
  };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Failed to load driver';
}
