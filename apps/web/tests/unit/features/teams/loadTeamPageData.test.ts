import { describe, expect, test } from 'vitest';
import { server } from '../../../support/msw/server';
import { apiError, apiOk, recordApiRequests } from '../../../support/msw/routes';
import { driver, driverB, team } from '../../../support/msw/fixtures';
import { loadTeamPageData } from '@/features/teams/loadTeamPageData';
import type {
  DriverSeasonStats, DriverStanding, PitCrewRanking, TeamDetailResponse, TeamHistory, TeamPitStop, TeamSeasonStats,
  TeamYearStats,
} from '@/types';

const NOW = new Date('2025-06-01T12:00:00Z');

const teamStats: TeamSeasonStats = {
  racesCompleted: 10, wins: 4, podiums: 9, totalPoints: '300', championshipPosition: 1,
  avgFinishPosition: '3.0', carPerformanceScore: '0.91000', dnfCount: 1, reliabilityScore: '0.95000',
  sprintTotalPoints: '20', championshipPoints: '320.0',
};

const driverStats: DriverSeasonStats = {
  racesEntered: 10, racesFinished: 9, wins: 3, podiums: 6, poles: 2,
  totalPoints: '180', championshipPosition: 1, avgFinishPosition: '2.6',
  winRate: '0.30', avgPositionGain: '0.5', dnfCount: 1, dnfRate: '0.10',
  avgSector1Ms: null, avgSector2Ms: null, avgSector3Ms: null,
  topSpeedAvg: null, teammateQualiDelta: null, sprintTotalPoints: '8', championshipPoints: '188.0',
};

const teammate = { ...driverB, id: 12, code: 'TSU', fullName: 'Yuki Tsunoda', team };

function season(year: number, teamId = 1): TeamYearStats {
  return { year, teamId, stats: teamStats };
}

function detail(): TeamDetailResponse {
  return { team, seasonStats: teamStats, drivers: [driver, teammate] };
}

function page(query = '') {
  return new URL(`http://localhost/teams/1${query}`);
}

describe('loadTeamPageData: other tabs', () => {
  test('the pit-crew tab fetches the rankings and that season\'s team stops, not standings', async () => {
    const requested = recordApiRequests();
    const ranking: PitCrewRanking = { team, stops: 30, medianStationaryMs: 2400, fastestStationaryMs: 1900 };
    const stop: TeamPitStop = { raceId: 3, roundNumber: 3, raceName: 'Japanese Grand Prix', driver, lapNumber: 20, stationaryMs: 2300 };
    server.use(
      apiOk('/api/teams/1/career', [season(2024, 6), season(2025)]),
      apiOk('/api/teams/1', detail()),
      apiOk('/api/teams/pit-stops', [ranking]),
      apiOk('/api/teams/6/pit-stops', [stop]),
    );

    const data = await loadTeamPageData(page('?year=2024&tab=pit-crew'), 1, NOW);

    expect(data.pitCrewRankings).toEqual([ranking]);
    expect(data.teamPitStops).toEqual([stop]);
    expect(data.hasPitCrewData).toBe(true);
    expect(requested.sort()).toEqual([
      '/api/teams/1/career', '/api/teams/1?year=2024', '/api/teams/6/pit-stops?year=2024', '/api/teams/pit-stops?year=2024',
    ]);
  });

  test('the history tab fetches the F1DB history and survives it failing', async () => {
    const history: TeamHistory = {
      constructor: { f1dbId: 'red-bull', name: 'Red Bull', championships: 6, raceStarts: 400, raceWins: 120, podiums: 280, polePositions: 100 },
      seasons: [{ year: 2025, chassis: 'RB21', engine: 'Honda RBPT' }],
    };
    server.use(apiOk('/api/teams/1/career', [season(2025)]), apiOk('/api/teams/1', detail()), apiOk('/api/teams/1/history', history));
    const loaded = await loadTeamPageData(page('?tab=history'), 1, NOW);

    server.use(apiError('/api/teams/1/history'));
    const missing = await loadTeamPageData(page('?tab=history'), 1, NOW);

    expect(loaded.teamHistory?.seasons[0].chassis).toBe('RB21');
    expect(missing.error).toBeNull();
    expect(missing.teamHistory).toBeNull();
  });
});

describe('loadTeamPageData: season tab', () => {
  test('opens the requested season and fetches its driver standings', async () => {
    const requested = recordApiRequests();
    const standings: DriverStanding[] = [{ driver, stats: driverStats }];
    server.use(
      apiOk('/api/teams/1/career', [season(2024), season(2025)]),
      apiOk('/api/teams/1', detail()),
      apiOk('/api/drivers/standings', standings),
    );

    const data = await loadTeamPageData(page('?year=2024'), 1, NOW);

    expect(data.tab).toBe('season');
    expect(data.year).toBe(2024);
    expect(data.detail?.team.name).toBe('Red Bull Racing');
    expect(requested.sort()).toEqual(['/api/drivers/standings?year=2024', '/api/teams/1/career', '/api/teams/1?year=2024']);
  });

  test('pairs the team\'s two drivers from the standings into head-to-head rows', async () => {
    const tsuStats: DriverSeasonStats = {
      ...driverStats, totalPoints: '40', sprintTotalPoints: '2', championshipPoints: '42.0', wins: 0, podiums: 1, poles: 0,
      avgFinishPosition: null, dnfCount: 3, racesEntered: 10,
    };
    server.use(
      apiOk('/api/teams/1/career', [season(2025)]),
      apiOk('/api/teams/1', detail()),
      apiOk('/api/drivers/standings', [
        { driver, stats: driverStats }, { driver: driverB, stats: driverStats }, { driver: teammate, stats: tsuStats },
      ]),
    );

    const data = await loadTeamPageData(page(), 1, NOW);

    expect(data.headToHead?.left.code).toBe('VER');
    expect(data.headToHead?.right.code).toBe('TSU');
    expect(data.headToHead?.rows.map(({ label, v1, v2, lowerBetter }) => ({ label, v1, v2, lowerBetter }))).toEqual([
      { label: 'Points', v1: 188, v2: 42, lowerBetter: undefined },
      { label: 'Wins', v1: 3, v2: 0, lowerBetter: undefined },
      { label: 'Podiums', v1: 6, v2: 1, lowerBetter: undefined },
      { label: 'Poles', v1: 2, v2: 0, lowerBetter: undefined },
      { label: 'Avg Finish', v1: 2.6, v2: 20, lowerBetter: true },
      { label: 'DNFs', v1: 1, v2: 3, lowerBetter: true },
      { label: 'Races', v1: 10, v2: 10, lowerBetter: undefined },
    ]);
    expect(data.headToHead?.rows[4].fmt?.(2.6)).toBe('P3');
  });

  test('failing standings only drop the head-to-head, not the page', async () => {
    server.use(
      apiOk('/api/teams/1/career', [season(2025)]),
      apiOk('/api/teams/1', detail()),
      apiError('/api/drivers/standings'),
    );

    const data = await loadTeamPageData(page(), 1, NOW);

    expect(data.error).toBeNull();
    expect(data.detail?.drivers).toHaveLength(2);
    expect(data.headToHead).toBeNull();
  });
});

describe('loadTeamPageData: failures and season links', () => {
  test('missing or empty career, or a failing season, is an error, not a throw', async () => {
    server.use(apiOk('/api/teams/1/career', []));
    const noRecords = await loadTeamPageData(page('?year=2023'), 1, NOW);

    server.use(apiError('/api/teams/1/career'));
    const noCareer = await loadTeamPageData(page(), 1, NOW);

    server.use(apiOk('/api/teams/1/career', [season(2019), season(2021)]), apiError('/api/teams/1', 404));
    const noSeason = await loadTeamPageData(page(), 1, NOW);

    expect(noRecords).toMatchObject({ error: 'Team has no career records', year: 2023, detail: null });
    expect(noCareer.error).toBe('API 500: /api/teams/1/career');
    expect(noSeason).toMatchObject({ error: 'API 404: /api/teams/1?year=2021', year: 2021, detail: null });
  });

  test('season links point at each season\'s team id and keep the open tab', async () => {
    server.use(
      apiOk('/api/teams/1/career', [season(2024, 6), season(2025)]),
      apiOk('/api/teams/1', detail()),
      apiOk('/api/drivers/standings', []),
      apiOk('/api/teams/1/history', null),
    );

    const onDefault = await loadTeamPageData(page('?year=2025'), 1, NOW);
    const onHistory = await loadTeamPageData(page('?year=2025&tab=history'), 1, NOW);

    expect(onDefault.yearLinks).toEqual([
      { year: 2024, href: '/teams/6?year=2024' },
      { year: 2025, href: '/teams/1?year=2025' },
    ]);
    expect(onHistory.yearLinks.map((l) => l.href)).toEqual(['/teams/6?year=2024&tab=history', '/teams/1?year=2025&tab=history']);
  });
});
