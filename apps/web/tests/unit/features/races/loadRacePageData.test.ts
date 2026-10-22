import { describe, expect, test } from 'vitest';
import type { RequestHandler } from 'msw';
import { server } from '../../../support/msw/server';
import { apiError, apiOk, recordApiRequests } from '../../../support/msw/routes';
import { circuit, driver, driverB } from '../../../support/msw/fixtures';
import { loadRacePageData } from '@/features/races/loadRacePageData';
import type {
  CircuitDetailResponse, LapSummary, PredictionResponse, QualifyingResult, Race, RaceControlMessage, RaceDetailResponse,
  RaceResult, Driver, SprintDetailResponse, SprintFeatureScores, SprintPredictionResponse, SprintResult,
} from '@/types';

const NOW = new Date('2025-10-01T12:00:00Z');

const race: Race = {
  id: 7, seasonId: 2025, roundNumber: 16, name: 'Italian Grand Prix',
  raceDate: '2025-09-07T13:00:00Z', raceDateUtc: '2025-09-07T13:00:00Z',
  status: 'completed', eventFormat: 'conventional',
  qualifyingDate: null, sprintDate: null, sprintQualifyingDate: null, hasSprint: false,
  weather: 'dry', safetyCarLaps: 2, vscLaps: null, airTempAvg: '24.6', trackTempAvg: null, humidityAvg: null,
  sprintWeather: null, sprintSafetyCarLaps: null, sprintVscLaps: null,
  sprintAirTempAvg: null, sprintTrackTempAvg: null, sprintHumidityAvg: null,
  circuit,
};

const results: RaceResult[] = [
  { id: 1, raceId: 7, driverId: 10, finishPosition: 1, gridPosition: 1, points: '25', status: 'Finished', fastestLap: false, driver },
  { id: 2, raceId: 7, driverId: 11, finishPosition: 2, gridPosition: 2, points: '18', status: 'Finished', fastestLap: true, driver: driverB },
];
const qualifying: QualifyingResult[] = [
  { id: 1, driverId: 10, gridPosition: 1, q1TimeMs: null, q2TimeMs: null, q3TimeMs: 80_000, sector1Ms: null, sector2Ms: null, sector3Ms: null, speedSt: null, driver },
];
const laps: LapSummary[] = [{ driverId: 11, fastestLapMs: 81_234, avgLapMs: 83_000, totalLaps: 53, driver: driverB }];

function gpDetail(overrides: Partial<RaceDetailResponse> = {}): RaceDetailResponse {
  return { race, results, qualifying, laps, ...overrides };
}

function gpPrediction(predictedWinner = driver): PredictionResponse {
  const features = {} as PredictionResponse['drivers'][number]['features'];
  return {
    race, predictedWinner, computedAt: '2025-09-06T20:00:00Z', modelVersion: 'weighted-v4',
    drivers: [
      { driver: driverB, winProbability: '0.31000', predictedPosition: 2, gridPosition: 2, features },
      { driver, winProbability: '0.46000', predictedPosition: 1, gridPosition: 1, features },
    ],
  };
}

const circuitDetail = {
  outlinePath: null, circuit, fastestLap: null,
  history: [
    { raceId: 3, raceName: 'Italian Grand Prix', raceDate: '2023-09-03', year: 2023, hasSprint: false, winner: null },
    { raceId: 7, raceName: 'Italian Grand Prix', raceDate: '2025-09-07', year: 2025, hasSprint: false, winner: null },
  ],
} as unknown as CircuitDetailResponse;

function quietEvents(raceId = 7): RequestHandler[] {
  return [
    apiOk(`/api/races/${raceId}/race-control`, []),
    apiOk(`/api/races/${raceId}/overtakes`, []),
    apiOk(`/api/races/${raceId}/team-radio`, []),
    apiOk(`/api/races/${raceId}/strategy`, { source: 'none', drivers: [] }),
  ];
}

function gpWeekend(detail: RaceDetailResponse = gpDetail(), prediction: PredictionResponse = gpPrediction()) {
  server.use(
    apiOk('/api/races/7', detail),
    apiOk('/api/predictions/race/7', prediction),
    apiOk('/api/races/circuit/monza', circuitDetail),
    ...quietEvents(),
  );
}

describe('loadRacePageData: grand prix', () => {
  test('a completed race shows results, qualifying, lap chart and circuit tabs', async () => {
    gpWeekend();

    const data = await loadRacePageData('gp', 7, NOW);

    expect(data.tabs.map((t) => t.id)).toEqual(['results', 'qualifying', 'laps', 'circuit']);
    expect(data.defaultTab).toBe('results');
  });

  test('after qualifying the race is not done: no results or laps tabs, zap badge, countdown on', async () => {
    gpWeekend(gpDetail({ race: { ...race, status: 'qualifying_done' } }));

    const data = await loadRacePageData('gp', 7, NOW);

    expect(data.isDone).toBe(false);
    expect(data.tabs.map((t) => t.id)).toEqual(['qualifying', 'circuit']);
    expect(data.status).toEqual({ icon: 'zap', label: 'qualifying done', toneClass: 'border-yellow-500/30 text-yellow-400/70' });
    expect(data.countdownTo).toBe('2025-09-07T13:00:00Z');
  });

  test('scores the prediction against the result', async () => {
    gpWeekend(gpDetail(), gpPrediction(driverB));

    const data = await loadRacePageData('gp', 7, NOW);

    expect(data.podium.map((p) => p.driver.code)).toEqual(['VER', 'LEC']);
    expect(data.confidence).toBe(46);
    expect(data.predCorrect).toBe(false);
    expect(data.actualWinnerName).toBe('Max Verstappen');
  });

  test('race event tabs slot in before the circuit; from 2026 the radio tab shows even when empty', async () => {
    const message: RaceControlMessage = {
      id: 1, raceId: 7, date: '2025-09-07T13:10:00Z', lapNumber: 3, category: 'Flag',
      flag: 'YELLOW', scope: 'Sector', sector: 2, driverNumber: null, message: 'YELLOW IN TRACK SECTOR 2',
    };
    gpWeekend();
    server.use(apiOk('/api/races/7/race-control', [message]));
    const in2025 = await loadRacePageData('gp', 7, NOW);

    gpWeekend(gpDetail({ race: { ...race, raceDate: '2026-03-08T04:00:00Z' } }));
    const in2026 = await loadRacePageData('gp', 7, NOW);

    expect(in2025.tabs.map((t) => t.id)).toEqual(['results', 'qualifying', 'laps', 'incidents', 'circuit']);
    expect(in2025.events.raceControlMessages).toHaveLength(1);
    expect(in2025.eventTabs).toEqual([{ id: 'incidents', label: 'Incidents' }]);
    expect(in2026.tabs.map((t) => t.id)).toEqual(['results', 'qualifying', 'laps', 'team-radio', 'circuit']);
  });

  test('fills the hero: other seasons here, race conditions, fastest lap and analysis links', async () => {
    gpWeekend();

    const data = await loadRacePageData('gp', 7, NOW);

    expect(data.yearItems).toEqual([{ year: 2025, href: '/races/7' }, { year: 2023, href: '/races/3' }]);
    expect(data.conditions).toEqual([{ label: 'SC Laps', val: 2 }, { label: 'Air', val: '25°C' }]);
    expect(data.fastestLap).toEqual({ code: 'LEC', timeStr: '1:21.234' });
    expect(data.sessionDate).toBe('2025-09-07T13:00:00Z');
    expect(data.links).toEqual([
      { href: '/races/7/race-story', label: 'Race story' },
      { href: '/races/7/telemetry', label: 'Telemetry' },
    ]);
  });

  test('lists grid drops: qualified one place, started another or from the pit lane', async () => {
    const qualified: QualifyingResult[] = [
      { ...qualifying[0], driverId: 10, gridPosition: 1, driver },
      { ...qualifying[0], id: 2, driverId: 11, gridPosition: 2, driver: driverB },
    ];
    gpWeekend(gpDetail({
      qualifying: qualified,
      results: [{ ...results[0], gridPosition: 6 }, { ...results[1], gridPosition: 0 }],
    }));

    const data = await loadRacePageData('gp', 7, NOW);

    expect(data.drops).toEqual([
      { code: 'VER', qualified: 1, started: 6, places: 5, pitLane: false },
      { code: 'LEC', qualified: 2, started: null, places: null, pitLane: true },
    ]);
    expect(data.driverMap.get(11)?.code).toBe('LEC');
  });

  test('a missing race is an error; a missing prediction or circuit only empties its slice', async () => {
    gpWeekend();
    server.use(apiError('/api/predictions/race/7'), apiError('/api/races/circuit/monza'));
    const partial = await loadRacePageData('gp', 7, NOW);

    server.use(apiError('/api/races/7', 404));
    const missing = await loadRacePageData('gp', 7, NOW);

    expect(partial).toMatchObject({ error: null, prediction: null, predCorrect: null, yearItems: [], confidence: 0 });
    expect(partial.race?.name).toBe('Italian Grand Prix');
    expect(missing).toMatchObject({ error: 'API 404: /api/races/7', race: null, results: [], tabs: [] });
  });
});

const sprintRace: Race = {
  ...race, hasSprint: true, status: 'qualifying_done', sprintDate: '2025-09-06T15:00:00Z',
  sprintSafetyCarLaps: 1, sprintAirTempAvg: '21.2',
};

function sprintRow(driverId: number, d: Driver, finishPosition: number | null, gridPosition: number, status = 'Finished'): SprintResult {
  return {
    id: driverId, raceId: 7, driverId, finishPosition, gridPosition, points: '8', status, fastestLap: false,
    sq1TimeMs: 90_000, sq2TimeMs: null, sq3TimeMs: null, sqSector1Ms: null, sqSector2Ms: null, sqSector3Ms: null,
    sqSpeedSt: null, driver: d,
  };
}

function sprintWeekend(detail: Partial<SprintDetailResponse> = {}) {
  const response: SprintDetailResponse = {
    race: sprintRace, prediction: null, laps,
    results: [sprintRow(10, driver, 1, 2), sprintRow(11, driverB, null, 1, 'grid_set')],
    ...detail,
  };
  server.use(
    apiOk('/api/sprint/race/7/detail', response),
    apiOk('/api/races/circuit/monza', circuitDetail),
    ...quietEvents(),
  );
}

describe('loadRacePageData: sprint', () => {
  test('once the sprint has run it shows results without grid-only rows, and the SQ grid with all of them', async () => {
    sprintWeekend();

    const data = await loadRacePageData('sprint', 7, NOW);

    expect(data.isDone).toBe(true);
    expect(data.status).toEqual({ icon: 'check', label: 'sprint done', toneClass: 'border-orange-500/30 text-orange-400/70' });
    expect(data.tabs).toEqual([
      { id: 'results', label: 'Results' }, { id: 'qualifying', label: 'Sprint Quali' },
      { id: 'laps', label: 'Lap Chart' }, { id: 'circuit', label: 'Circuit' },
    ]);
    expect(data.results.map((r) => r.driver.code)).toEqual(['VER']);
    expect(data.qualifying.map((q) => q.driver.code)).toEqual(['LEC', 'VER']);
  });

  test('before the sprint: countdown to the sprint, its own prediction, sprint events and sprint-only seasons', async () => {
    const requested = recordApiRequests();
    const upcoming: Race = { ...sprintRace, status: 'sprint_qualifying_done' };
    const prediction: SprintPredictionResponse = {
      race: upcoming, predictedWinner: driverB, computedAt: '2025-09-05T20:00:00Z', modelVersion: 'sprint-v2',
      drivers: [{ driver: driverB, winProbability: '0.52000', predictedPosition: 1, gridPosition: 1, features: {} as SprintFeatureScores }],
    };
    sprintWeekend({ race: upcoming, prediction, results: [sprintRow(10, driver, null, 1, 'grid_set')], laps: [] });

    const data = await loadRacePageData('sprint', 7, NOW);

    expect(data).toMatchObject({
      isDone: false, countdownTo: '2025-09-06T15:00:00Z', sessionDate: '2025-09-06T15:00:00Z',
      confidence: 52, predCorrect: null, actualWinnerName: null, links: [], yearItems: [],
      status: { icon: 'timer', label: 'sprint upcoming' },
      conditions: [{ label: 'SC Laps', val: 1 }, { label: 'Air', val: '21°C' }],
    });
    expect(data.tabs.map((t) => t.id)).toEqual(['qualifying', 'circuit']);
    expect(requested).toContain('/api/races/7/race-control?session=sprint');
  });
});
