import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  api: {
    getPredictionByRace: vi.fn(),
    getRaceById: vi.fn(),
    getSprintByRaceId: vi.fn(),
    getSprintDetail: vi.fn(),
  },
}));

import { api } from '@/lib/api';
import { buildPredictionPageData } from '@/features/predictions/buildPredictionPageData';
import type {
  Circuit, Driver, Team, Race, RaceResult, RaceDetailResponse, PredictionResponse, FeatureScores,
  SprintResult, SprintDetailResponse, SprintPredictionResponse, SprintFeatureScores,
} from '@/types';

const team: Team = { id: 1, seasonId: 2025, teamKey: 'red-bull', name: 'Red Bull Racing', nationality: 'Austrian' };
const driver: Driver = {
  id: 10, seasonId: 2025, teamId: 1, driverNumber: 1, code: 'VER',
  firstName: 'Max', lastName: 'Verstappen', fullName: 'Max Verstappen',
  nationality: 'Dutch', headshotUrl: null, team,
};
const driverB: Driver = {
  id: 11, seasonId: 2025, teamId: 2, driverNumber: 16, code: 'LEC',
  firstName: 'Charles', lastName: 'Leclerc', fullName: 'Charles Leclerc',
  nationality: 'Monegasque', headshotUrl: null, team: { ...team, id: 2, teamKey: 'ferrari', name: 'Ferrari' },
};
const circuit: Circuit = {
  id: 5, circuitKey: 'monza', name: 'Autodromo Nazionale Monza', country: 'Italy', city: 'Monza',
  lapCount: 53, trackLengthKm: '5.793', overtakeRate: '0.850',
  numberOfCorners: 11, drsZones: 2, scProbability: '0.300', imageUrl: null,
};
const race: Race = {
  id: 1, seasonId: 2025, roundNumber: 5, name: 'Italian Grand Prix',
  raceDate: '2025-09-07T13:00:00Z', raceDateUtc: '2025-09-07T13:00:00Z',
  status: 'completed', eventFormat: 'conventional',
  qualifyingDate: null, sprintDate: '2025-09-06T13:00:00Z', sprintQualifyingDate: null, hasSprint: true,
  weather: null, safetyCarLaps: null, vscLaps: null, airTempAvg: null, trackTempAvg: null, humidityAvg: null,
  sprintWeather: null, sprintSafetyCarLaps: null, sprintVscLaps: null,
  sprintAirTempAvg: null, sprintTrackTempAvg: null, sprintHumidityAvg: null,
  circuit,
};

const gpFeatures: FeatureScores = {
  carPerformance: '0.80000', driverRating: '0.75000', startingPosition: '0.90000', winRate: '0.70000',
  luckFactor: '0.50000', weatherImpact: '0.50000', trackOvertake: null, positionGain: '0.55000',
  longRunPace: '0.65000', reliability: '0.85000', qualifyingDelta: '0.60000', sectorStrength: '0.70000',
  tyreDeg: '0.60000', circuitAdjStartPos: '0.72000', circuitAdjPositionGain: '0.40000',
};
const sprintFeatures: SprintFeatureScores = {
  carPerformance: '0.80000', startingPosition: '0.90000', driverRating: '0.75000', trackOvertake: null,
  shortRunPace: '0.65000', weatherImpact: '0.50000', winRate: '0.70000', luckFactor: '0.50000',
  circuitAdjStartPos: '0.72000', sqQualifyingDelta: '0.60000',
};

function gpPrediction(predictedWinner: Driver = driver): PredictionResponse {
  return {
    race, predictedWinner, computedAt: '2025-09-07T12:00:00.000Z', modelVersion: 'weighted-v3',
    drivers: [
      { driver, winProbability: '0.62000', predictedPosition: 1, features: gpFeatures },
      { driver: driverB, winProbability: '0.38000', predictedPosition: 2, features: gpFeatures },
    ],
  };
}

function gpDetail(winnerDriver: Driver = driver): RaceDetailResponse {
  const results: RaceResult[] = [
    { id: 1, raceId: 1, driverId: winnerDriver.id, finishPosition: 1, gridPosition: 1, points: '25', status: 'Finished', fastestLap: true, driver: winnerDriver },
    { id: 2, raceId: 1, driverId: driverB.id, finishPosition: 2, gridPosition: 2, points: '18', status: 'Finished', fastestLap: false, driver: driverB },
  ];
  return { race, results, qualifying: [], laps: [] };
}

function sprintPrediction(): SprintPredictionResponse {
  return {
    race, predictedWinner: driver, computedAt: '2025-09-06T12:00:00.000Z', modelVersion: 'sprint-v2',
    drivers: [
      { driver, winProbability: '0.55000', predictedPosition: 1, features: sprintFeatures },
      { driver: driverB, winProbability: '0.45000', predictedPosition: 2, features: sprintFeatures },
    ],
  };
}

function sprintDetail(): SprintDetailResponse {
  const results: SprintResult[] = [
    {
      id: 1, raceId: 1, driverId: driver.id, finishPosition: 1, gridPosition: 1, points: '8', status: 'Finished',
      fastestLap: true, sq1TimeMs: null, sq2TimeMs: null, sq3TimeMs: null,
      sqSector1Ms: null, sqSector2Ms: null, sqSector3Ms: null, sqSpeedSt: null, driver,
    },
  ];
  return { race, prediction: null, results, laps: [] };
}

beforeEach(() => {
  vi.mocked(api.getPredictionByRace).mockReset();
  vi.mocked(api.getRaceById).mockReset();
  vi.mocked(api.getSprintByRaceId).mockReset();
  vi.mocked(api.getSprintDetail).mockReset();
});

describe('buildPredictionPageData: gp', () => {
  test('happy path assembles the full view model', async () => {
    vi.mocked(api.getPredictionByRace).mockResolvedValue(gpPrediction());
    vi.mocked(api.getRaceById).mockResolvedValue(gpDetail());

    const data = await buildPredictionPageData('gp', 1);

    expect(data.predictionFailed).toBe(false);
    expect(data.race?.id).toBe(1);
    expect(data.date).toBe(race.raceDate);
    expect(data.results).toHaveLength(2);
    expect(data.actualWinner?.driver.id).toBe(driver.id);
    expect(data.correct).toBe(true);
    expect(data.winner?.driver.id).toBe(driver.id);
    expect(data.breakdown.length).toBeGreaterThan(0);
    expect(data.radarFeatures).toHaveLength(12);
  });

  test('prediction fetch failure falls back to the race detail response', async () => {
    vi.mocked(api.getPredictionByRace).mockRejectedValue(new Error('500'));
    vi.mocked(api.getRaceById).mockResolvedValue(gpDetail());

    const data = await buildPredictionPageData('gp', 1);

    expect(data.predictionFailed).toBe(true);
    expect(data.prediction).toBeNull();
    expect(data.race?.id).toBe(1);
    expect(data.winner).toBeNull();
    expect(data.breakdown).toEqual([]);
  });

  test('detail fetch failure leaves results/actualWinner empty but keeps the prediction', async () => {
    vi.mocked(api.getPredictionByRace).mockResolvedValue(gpPrediction());
    vi.mocked(api.getRaceById).mockRejectedValue(new Error('500'));

    const data = await buildPredictionPageData('gp', 1);

    expect(data.predictionFailed).toBe(false);
    expect(data.race?.id).toBe(1);
    expect(data.results).toBeUndefined();
    expect(data.actualWinner).toBeNull();
    expect(data.correct).toBeNull();
    expect(data.winner?.driver.id).toBe(driver.id);
  });

  test('winner falls back to the first driver when predictedWinner is not in the field', async () => {
    const stranger: Driver = { ...driver, id: 999 };
    vi.mocked(api.getPredictionByRace).mockResolvedValue(gpPrediction(stranger));
    vi.mocked(api.getRaceById).mockResolvedValue(gpDetail());

    const data = await buildPredictionPageData('gp', 1);

    expect(data.winner?.driver.id).toBe(driver.id);
  });

  test('correct is false when the actual winner differs from the predicted winner', async () => {
    vi.mocked(api.getPredictionByRace).mockResolvedValue(gpPrediction(driver));
    vi.mocked(api.getRaceById).mockResolvedValue(gpDetail(driverB));

    const data = await buildPredictionPageData('gp', 1);

    expect(data.correct).toBe(false);
  });

  test('no race is resolvable when both responses fail', async () => {
    vi.mocked(api.getPredictionByRace).mockRejectedValue(new Error('500'));
    vi.mocked(api.getRaceById).mockRejectedValue(new Error('500'));

    const data = await buildPredictionPageData('gp', 1);

    expect(data.race).toBeNull();
    expect(data.date).toBeNull();
    expect(data.predictionFailed).toBe(true);
    expect(data.winner).toBeNull();
  });
});

describe('buildPredictionPageData: sprint', () => {
  test('happy path uses the sprint behaviour axis (date field, radar count)', async () => {
    vi.mocked(api.getSprintByRaceId).mockResolvedValue(sprintPrediction());
    vi.mocked(api.getSprintDetail).mockResolvedValue(sprintDetail());

    const data = await buildPredictionPageData('sprint', 1);

    expect(data.predictionFailed).toBe(false);
    expect(data.date).toBe(race.sprintDate);
    expect(data.radarFeatures).toHaveLength(8);
    expect(data.correct).toBe(true);
  });

  test('sprint fetch failure flags predictionFailed with no prediction', async () => {
    vi.mocked(api.getSprintByRaceId).mockRejectedValue(new Error('500'));
    vi.mocked(api.getSprintDetail).mockResolvedValue(sprintDetail());

    const data = await buildPredictionPageData('sprint', 1);

    expect(data.predictionFailed).toBe(true);
    expect(data.prediction).toBeNull();
  });
});
