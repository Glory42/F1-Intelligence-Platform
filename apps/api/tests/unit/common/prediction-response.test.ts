import { describe, expect, test } from 'bun:test';
import { buildPredictionResponse, type RaceRowResult, type NormalizedFeatureRow, type PredictionResponseConfig } from '../../../src/common/prediction-response';
import type { Db } from '../../../src/config/database';
import type { teams, drivers, races, circuits } from '../../../src/db/schema';

const fakeDb = {} as Db;

const team: typeof teams.$inferSelect = {
  id: 1, seasonId: 2025, teamKey: 'red-bull', name: 'Red Bull Racing', nationality: 'Austrian',
  createdAt: new Date('2025-01-01T00:00:00Z'),
};

const driver: typeof drivers.$inferSelect = {
  id: 10, seasonId: 2025, teamId: 1, driverNumber: 1, code: 'VER',
  firstName: 'Max', lastName: 'Verstappen', nationality: 'Dutch', headshotUrl: null,
  createdAt: new Date('2025-01-01T00:00:00Z'),
};

const circuit: typeof circuits.$inferSelect = {
  id: 5, circuitKey: 'monza', name: 'Autodromo Nazionale Monza', country: 'Italy', city: 'Monza',
  lapCount: 53, trackLengthKm: '5.793', overtakeRate: '0.850', numberOfCorners: 11, drsZones: 2,
  scProbability: '0.300', imageUrl: null, trackCategory: 'high_speed', createdAt: new Date('2025-01-01T00:00:00Z'),
};

const race: typeof races.$inferSelect = {
  id: 100, seasonId: 2025, circuitId: 5, roundNumber: 16, name: 'Italian Grand Prix',
  raceDate: '2025-09-07', raceDateUtc: new Date('2025-09-07T13:00:00Z'), status: 'completed',
  eventFormat: 'conventional', qualifyingDate: null, sprintDate: null, sprintQualifyingDate: null,
  weather: 'dry', safetyCarLaps: 0, vscLaps: 0, airTempAvg: null, trackTempAvg: null, humidityAvg: null,
  sprintWeather: null, sprintSafetyCarLaps: null, sprintVscLaps: null, sprintAirTempAvg: null,
  sprintTrackTempAvg: null, sprintHumidityAvg: null, openf1RaceSessionKey: null, openf1SprintSessionKey: null, createdAt: new Date('2025-01-01T00:00:00Z'),
};

const raceRow: RaceRowResult = {
  prediction: { predictedWinnerId: 10, computedAt: new Date('2025-09-07T12:00:00Z'), modelVersion: 'weighted-v3' },
  race,
  circuit,
};

type Raw = { carPerformanceScore: string };
type Features = { carPerformance: number };

const featureRow: NormalizedFeatureRow<Raw> = {
  driverId: 10,
  driver,
  team,
  winProbability: '0.42000',
  predictedPosition: 1,
  raw: { carPerformanceScore: '0.80000' },
};

function baseConfig(overrides: Partial<PredictionResponseConfig<Raw, Features>> = {}): PredictionResponseConfig<Raw, Features> {
  return {
    target: 'upcoming',
    queryUpcoming: async () => [raceRow],
    queryById: async () => [raceRow],
    fetchFeatureRows: async () => [featureRow],
    toFeatures: (raw) => ({ carPerformance: parseFloat(raw.carPerformanceScore) }),
    ...overrides,
  };
}

describe('buildPredictionResponse', () => {
  test('returns null when no race rows are found', async () => {
    const result = await buildPredictionResponse(fakeDb, baseConfig({ queryUpcoming: async () => [] }));
    expect(result).toBeNull();
  });

  test('returns null when the predicted winner is not present in the feature rows', async () => {
    const result = await buildPredictionResponse(fakeDb, baseConfig({ fetchFeatureRows: async () => [] }));
    expect(result).toBeNull();
  });

  test('assembles the full response on the happy path', async () => {
    const result = await buildPredictionResponse(fakeDb, baseConfig());
    expect(result).not.toBeNull();
    expect(result!.race.id).toBe(100);
    expect(result!.predictedWinner.id).toBe(10);
    expect(result!.modelVersion).toBe('weighted-v3');
    expect(result!.computedAt).toBe('2025-09-07T12:00:00.000Z');
    expect(result!.drivers).toEqual([
      { driver: expect.objectContaining({ id: 10 }), winProbability: '0.42000', predictedPosition: 1, features: { carPerformance: 0.8 } },
    ]);
  });

  test('queries by race id when target is a number', async () => {
    const queriedIds: number[] = [];
    const config = baseConfig({
      target: 42,
      queryById: async (_db, id) => { queriedIds.push(id); return [raceRow]; },
    });
    await buildPredictionResponse(fakeDb, config);
    expect(queriedIds).toEqual([42]);
  });
});
