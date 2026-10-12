import { api } from '@/lib/api';
import { resolveCareerYear, type YearLink } from '@/lib/careerYear';
import { resolveTab, seasonTabHref } from '@/lib/pageTabs';
import { unwrapSettled } from '@/lib/utils';
import type { HeadToHeadRow } from '@/components/data/headToHead';
import type {
  Driver, DriverStanding, PitCrewRanking, TeamDetailResponse, TeamHistory, TeamPitStop, TeamYearStats,
} from '@/types';

export const TEAM_TABS = [
  { id: 'season', label: 'This season' },
  { id: 'pit-crew', label: 'Pit crew' },
  { id: 'history', label: 'History' },
] as const;

export type TeamTab = (typeof TEAM_TABS)[number]['id'];

export interface TeammateHeadToHead {
  left: Driver;
  right: Driver;
  rows: HeadToHeadRow[];
}

export interface TeamPageData {
  tab: TeamTab;
  year: number;
  yearLinks: YearLink[];
  error: string | null;
  career: TeamYearStats[];
  detail: TeamDetailResponse | null;
  headToHead: TeammateHeadToHead | null;
  pitCrewRankings: PitCrewRanking[];
  teamPitStops: TeamPitStop[];
  hasPitCrewData: boolean;
  teamHistory: TeamHistory | null;
}

const NONE = Promise.resolve(null);

const NO_TEAM = {
  detail: null, headToHead: null, pitCrewRankings: [], teamPitStops: [], hasPitCrewData: false, teamHistory: null,
} satisfies Partial<TeamPageData>;

export async function loadTeamPageData(url: URL, teamId: number, now: Date = new Date()): Promise<TeamPageData> {
  const tab = resolveTab(url, TEAM_TABS);
  const requested = url.searchParams.get('year');
  const yearLinksOf = (career: TeamYearStats[]): YearLink[] =>
    career.map((y) => ({ year: y.year, href: seasonTabHref(url, TEAM_TABS, tab, y.year, `/teams/${y.teamId}`) }));
  const failed = (error: string, year: number, career: TeamYearStats[]): TeamPageData =>
    ({ ...NO_TEAM, tab, year, error, career, yearLinks: yearLinksOf(career) });
  const fallbackYear = Number(requested ?? now.getFullYear());

  let career: TeamYearStats[];
  try {
    career = await api.getTeamCareer(teamId);
  } catch (e) {
    return failed(errorMessage(e), fallbackYear, []);
  }
  const year = resolveCareerYear(career.map((y) => y.year), requested ? Number(requested) : null, now.getFullYear());
  if (year == null) return failed('Team has no career records', fallbackYear, career);

  // Team ids are season-scoped, so per-season endpoints take the id that team had that year.
  const seasonTeamId = career.find((y) => y.year === year)?.teamId ?? teamId;
  const [detailResult, standingsResult, rankingsResult, stopsResult, historyResult] = await Promise.allSettled([
    api.getTeamById(teamId, year),
    tab === 'season' ? api.getDriverStandings(year) : NONE,
    tab === 'pit-crew' ? api.getPitCrewRankings(year) : NONE,
    tab === 'pit-crew' ? api.getTeamPitStops(seasonTeamId, year) : NONE,
    tab === 'history' ? api.getTeamHistory(teamId) : NONE,
  ]);
  if (detailResult.status === 'rejected') return failed(errorMessage(detailResult.reason), year, career);

  const detail = detailResult.value;
  const pitCrewRankings = unwrapSettled(rankingsResult, null) ?? [];
  return {
    tab,
    year,
    yearLinks: yearLinksOf(career),
    error: null,
    career,
    detail,
    headToHead: teammateHeadToHead(detail, unwrapSettled(standingsResult, null) ?? []),
    pitCrewRankings,
    teamPitStops: unwrapSettled(stopsResult, null) ?? [],
    hasPitCrewData: pitCrewRankings.some((r) => r.team.id === detail.team.id),
    teamHistory: unwrapSettled(historyResult, null),
  };
}

function teammateHeadToHead(detail: TeamDetailResponse, standings: DriverStanding[]): TeammateHeadToHead | null {
  const driverIds = new Set(detail.drivers.map((d) => d.id));
  const [d1, d2] = standings.filter((s) => driverIds.has(s.driver.id));
  if (!d1 || !d2) return null;
  return {
    left: d1.driver,
    right: d2.driver,
    rows: [
      { label: 'Points', v1: Number(d1.stats.championshipPoints), v2: Number(d2.stats.championshipPoints) },
      { label: 'Wins', v1: d1.stats.wins, v2: d2.stats.wins },
      { label: 'Podiums', v1: d1.stats.podiums, v2: d2.stats.podiums },
      { label: 'Poles', v1: d1.stats.poles, v2: d2.stats.poles },
      {
        label: 'Avg Finish', v1: Number(d1.stats.avgFinishPosition ?? 20), v2: Number(d2.stats.avgFinishPosition ?? 20),
        lowerBetter: true, fmt: (v) => `P${Math.round(v)}`,
      },
      { label: 'DNFs', v1: d1.stats.dnfCount, v2: d2.stats.dnfCount, lowerBetter: true },
      { label: 'Races', v1: d1.stats.racesEntered, v2: d2.stats.racesEntered },
    ],
  };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Failed to load team';
}
