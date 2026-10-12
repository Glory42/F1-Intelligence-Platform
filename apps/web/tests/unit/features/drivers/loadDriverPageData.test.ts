import { describe, expect, test } from 'vitest';
import { server } from '../../../support/msw/server';
import { apiError, apiOk, recordApiRequests } from '../../../support/msw/routes';
import { circuit, driver, driverB } from '../../../support/msw/fixtures';
import { loadDriverPageData } from '@/features/drivers/loadDriverPageData';
import type {
  Driver, DriverDetailResponse, DriverHistory, DriverSeasonStats, DriverYearStats, PredictionHistoryItem, TeammateBattle,
} from '@/types';

const NOW = new Date('2025-06-01T12:00:00Z');

const stats: DriverSeasonStats = {
  racesEntered: 10, racesFinished: 9, wins: 3, podiums: 6, poles: 2,
  totalPoints: '180', championshipPosition: 2, avgFinishPosition: '3.4',
  winRate: '0.30', avgPositionGain: '0.5', dnfCount: 1, dnfRate: '0.10',
  avgSector1Ms: null, avgSector2Ms: null, avgSector3Ms: null,
  topSpeedAvg: null, teammateQualiDelta: null, sprintTotalPoints: '12',
};

function season(year: number, overrides: Partial<DriverYearStats> = {}): DriverYearStats {
  return { year, driverId: 10, driverNumberThatYear: 1, teamName: 'Red Bull Racing', headshotUrl: null, stats, ...overrides };
}

function detail(): DriverDetailResponse {
  return { driver, seasonStats: stats, recentResults: [] };
}

function page(query = '') {
  return new URL(`http://localhost/drivers/10${query}`);
}

describe('loadDriverPageData: season resolution', () => {
  test('opens the requested season when the driver raced in it', async () => {
    server.use(
      apiOk('/api/drivers/10/career', [season(2023), season(2024), season(2025)]),
      apiOk('/api/drivers/10', detail()),
    );

    const data = await loadDriverPageData(page('?year=2024'), 10, NOW);

    expect(data.year).toBe(2024);
    expect(data.detail?.driver.fullName).toBe('Max Verstappen');
  });

  test('falls back to the current season when the requested one is not in the career', async () => {
    const requested = recordApiRequests();
    server.use(
      apiOk('/api/drivers/10/career', [season(2023), season(2025)]),
      apiOk('/api/drivers/10', detail()),
    );

    const data = await loadDriverPageData(page('?year=2019'), 10, NOW);

    expect(data.year).toBe(2025);
    expect(requested).toContain('/api/drivers/10?year=2025');
  });

  test('falls back to the latest season for a driver no longer racing', async () => {
    server.use(
      apiOk('/api/drivers/10/career', [season(2016), season(2021), season(2018)]),
      apiOk('/api/drivers/10', detail()),
    );

    const data = await loadDriverPageData(page(), 10, NOW);

    expect(data.year).toBe(2021);
  });
});

const battle: TeammateBattle = {
  teammate: driverB, sharedRaces: 10,
  qualifying: { driver: 7, teammate: 3 }, race: { driver: 6, teammate: 4 }, points: { driver: 180, teammate: 120 },
  medianQualiGapMs: -150, races: [],
};

describe('loadDriverPageData: active tab', () => {
  test('the default season tab fetches only the career and the season', async () => {
    const requested = recordApiRequests();
    server.use(apiOk('/api/drivers/10/career', [season(2025)]), apiOk('/api/drivers/10', detail()));

    const data = await loadDriverPageData(page(), 10, NOW);

    expect(data.tab).toBe('season');
    expect(requested.sort()).toEqual(['/api/drivers/10/career', '/api/drivers/10?year=2025']);
  });

  test('the teammate tab fetches the battle for that season\'s driver id', async () => {
    const requested = recordApiRequests();
    server.use(
      apiOk('/api/drivers/10/career', [season(2024, { driverId: 7 }), season(2025)]),
      apiOk('/api/drivers/10', detail()),
      apiOk('/api/drivers/7/teammate-battle', battle),
    );

    const data = await loadDriverPageData(page('?year=2024&tab=teammate'), 10, NOW);

    expect(data.tab).toBe('teammate');
    expect(data.teammateBattle?.sharedRaces).toBe(10);
    expect(requested.sort()).toEqual([
      '/api/drivers/10/career', '/api/drivers/10?year=2024', '/api/drivers/7/teammate-battle?year=2024',
    ]);
  });
});

const history: DriverHistory = {
  f1dbId: 'max-verstappen', name: 'Max Verstappen', dateOfBirth: '1997-09-30', nationality: 'netherlands',
  championships: 4, raceStarts: 200, raceWins: 63, podiums: 110, polePositions: 40,
  fastestLaps: 32, careerPoints: 3000, sprintWins: 12, grandSlams: 6,
  firstRaceDate: null, firstRaceName: null, firstWinDate: null, firstWinName: null,
  firstPodiumDate: null, firstPodiumName: null, firstPoleDate: null, firstPoleName: null,
};

describe('loadDriverPageData: optional tab data', () => {
  test('a failing teammate battle degrades to null and keeps the page', async () => {
    server.use(
      apiOk('/api/drivers/10/career', [season(2025)]),
      apiOk('/api/drivers/10', detail()),
      apiError('/api/drivers/10/teammate-battle'),
    );

    const data = await loadDriverPageData(page('?tab=teammate'), 10, NOW);

    expect(data.error).toBeNull();
    expect(data.detail?.driver.code).toBe('VER');
    expect(data.teammateBattle).toBeNull();
  });

  test('the career tab fetches the all-time history', async () => {
    server.use(
      apiOk('/api/drivers/10/career', [season(2025)]),
      apiOk('/api/drivers/10', detail()),
      apiOk('/api/drivers/10/history', history),
    );

    const data = await loadDriverPageData(page('?tab=career'), 10, NOW);

    expect(data.driverHistory?.raceStarts).toBe(200);
  });

  test('the model tab tallies the races the model tipped this driver to win', async () => {
    const tip = (raceId: number, roundNumber: number, predictedWinner: Driver, correct: boolean | null): PredictionHistoryItem => ({
      raceId, raceName: `Round ${roundNumber}`, raceDate: '2025-05-01', roundNumber, circuit,
      predictedWinner, actualWinner: null, winProbability: '0.40000', correct, computedAt: '2025-05-01T00:00:00Z',
      isSprint: false, actualWinnerPredictedPosition: null,
    });
    server.use(
      apiOk('/api/drivers/10/career', [season(2025)]),
      apiOk('/api/drivers/10', detail()),
      apiOk('/api/predictions/history', [tip(3, 3, driver, false), tip(1, 1, driver, true), tip(2, 2, driverB, true), tip(4, 4, driver, null)]),
    );

    const data = await loadDriverPageData(page('?tab=model'), 10, NOW);

    expect(data.predictionRecord).toMatchObject({ tipped: 3, decided: 2, correct: 1 });
    expect(data.predictionRecord?.races.map((r) => r.roundNumber)).toEqual([1, 3, 4]);
  });
});

describe('loadDriverPageData: header', () => {
  test('borrows a headshot from another season when this one has none', async () => {
    server.use(
      apiOk('/api/drivers/10/career', [season(2023), season(2024, { headshotUrl: 'https://img/ver-2024.png' }), season(2025)]),
      apiOk('/api/drivers/10', detail()),
    );

    const data = await loadDriverPageData(page(), 10, NOW);

    expect(data.headshotUrl).toBe('https://img/ver-2024.png');
  });

  test('counts titles from finished seasons only, not a current-season P1', async () => {
    const champion = { ...stats, championshipPosition: 1 };
    server.use(
      apiOk('/api/drivers/10/career', [
        season(2022, { stats: champion }), season(2023, { stats: champion }),
        season(2024, { stats: { ...stats, championshipPosition: 3 } }), season(2025, { stats: champion }),
      ]),
      apiOk('/api/drivers/10', detail()),
    );

    const data = await loadDriverPageData(page(), 10, NOW);

    expect(data.titles).toBe(2);
  });

  test('flags the driver by nationality, or by driver code when nationality is missing', async () => {
    server.use(apiOk('/api/drivers/10/career', [season(2025)]), apiOk('/api/drivers/10', detail()));
    const dutch = await loadDriverPageData(page(), 10, NOW);

    server.use(apiOk('/api/drivers/10', { ...detail(), driver: { ...driver, nationality: null } }));
    const byCode = await loadDriverPageData(page(), 10, NOW);

    expect(dutch.nationalityFlag).toBe('🇳🇱');
    expect(byCode.nationalityFlag).toBe('🇳🇱');
  });

  test('season links point at each season\'s driver id and keep the open tab', async () => {
    server.use(
      apiOk('/api/drivers/10/career', [season(2024, { driverId: 7 }), season(2025)]),
      apiOk('/api/drivers/10', detail()),
      apiOk('/api/drivers/10/history', history),
    );

    const onDefault = await loadDriverPageData(page('?year=2025'), 10, NOW);
    const onCareer = await loadDriverPageData(page('?year=2025&tab=career'), 10, NOW);

    expect(onDefault.yearLinks).toEqual([
      { year: 2024, href: '/drivers/7?year=2024' },
      { year: 2025, href: '/drivers/10?year=2025' },
    ]);
    expect(onCareer.yearLinks.map((l) => l.href)).toEqual(['/drivers/7?year=2024&tab=career', '/drivers/10?year=2025&tab=career']);
  });
});

describe('loadDriverPageData: failures', () => {
  test('a driver with no career records is an error and keeps the requested year', async () => {
    const requested = recordApiRequests();
    server.use(apiOk('/api/drivers/10/career', []));

    const data = await loadDriverPageData(page('?year=2024'), 10, NOW);

    expect(data.error).toBe('Driver has no career records');
    expect(data.year).toBe(2024);
    expect(data.detail).toBeNull();
    expect(requested).toEqual(['/api/drivers/10/career']);
  });

  test('a failing career or season fetch is an error, not a throw', async () => {
    server.use(apiError('/api/drivers/10/career', 404));
    const noCareer = await loadDriverPageData(page(), 10, NOW);

    server.use(apiOk('/api/drivers/10/career', [season(2025)]), apiError('/api/drivers/10'));
    const noSeason = await loadDriverPageData(page(), 10, NOW);

    expect(noCareer.error).toBe('API 404: /api/drivers/10/career');
    expect(noCareer.career).toEqual([]);
    expect(noSeason.error).toBe('API 500: /api/drivers/10?year=2025');
    expect(noSeason.detail).toBeNull();
  });
});
