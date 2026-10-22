import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { createSeason } from '../../support/factories/season.factory';
import { createCircuit } from '../../support/factories/circuit.factory';
import { createTeam } from '../../support/factories/team.factory';
import { createDriver } from '../../support/factories/driver.factory';
import { createRace } from '../../support/factories/race.factory';
import { createRaceResult } from '../../support/factories/raceResult.factory';
import { createRacePrediction } from '../../support/factories/prediction.factory';
import { createDriverPredictionFeatures } from '../../support/factories/driverPredictionFeatures.factory';

describe('predictions (integration)', () => {
  const db = getTestDb();
  let upcomingRaceId: number;
  let completedRaceId: number;

  beforeAll(async () => {
    await truncateAll(db);

    const season = await createSeason(db, { year: 2099 });
    const circuit = await createCircuit(db, { circuitKey: 'predictions-test-circuit', name: 'Predictions Test Circuit' });
    const team = await createTeam(db, season.id);
    const winner = await createDriver(db, season.id, team.id, { driverNumber: 1, code: 'AAA', firstName: 'Ada', lastName: 'Ace' });
    const other = await createDriver(db, season.id, team.id, { driverNumber: 2, code: 'BBB', firstName: 'Ben', lastName: 'Bee' });

    // Upcoming: qualifying_done + a future race date is what /upcoming filters on.
    const upcoming = await createRace(db, season.id, circuit.id, {
      roundNumber: 1, name: 'Upcoming GP', raceDate: '2099-03-01', status: 'qualifying_done',
    });
    await createRacePrediction(db, upcoming.id, winner.id);
    await createDriverPredictionFeatures(db, upcoming.id, winner.id, { winProbability: '0.55000', predictedPosition: 1 });
    await createDriverPredictionFeatures(db, upcoming.id, other.id, { winProbability: '0.20000', predictedPosition: 2 });

    // Completed prior round with a correct prediction: feeds history + accuracy.
    const completed = await createRace(db, season.id, circuit.id, {
      roundNumber: 2, name: 'Completed GP', raceDate: '2099-02-01', status: 'completed',
    });
    await createRacePrediction(db, completed.id, winner.id);
    await createDriverPredictionFeatures(db, completed.id, winner.id, { winProbability: '0.60000', predictedPosition: 1 });
    await createDriverPredictionFeatures(db, completed.id, other.id, { winProbability: '0.15000', predictedPosition: 2 });
    await createRaceResult(db, completed.id, winner.id, { finishPosition: 1, gridPosition: 1 });
    await createRaceResult(db, completed.id, other.id, { finishPosition: 2, gridPosition: 2 });

    upcomingRaceId = upcoming.id;
    completedRaceId = completed.id;
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it('returns the upcoming prediction with the predicted winner and every driver row', async () => {
    const res = await apiRequest('/api/predictions/upcoming');
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        predictedWinner: { code: string }; modelVersion: string; race: { status: string };
        drivers: Array<{ features: Record<string, { value: number; contribution: number }> }>;
      };
    };
    expect(data.predictedWinner.code).toBe('AAA');
    expect(data.modelVersion).toBe('weighted-v4');
    expect(data.race.status).toBe('qualifying_done');
    expect(data.drivers).toHaveLength(2);
    expect(data.drivers[0].features.teamRacePace).toEqual({ value: -0.15, contribution: 0.35 });
  });

  it('returns a prediction by race id', async () => {
    const res = await apiRequest(`/api/predictions/race/${completedRaceId}`);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { predictedWinner: { code: string }; race: { status: string } } };
    expect(data.predictedWinner.code).toBe('AAA');
    expect(data.race.status).toBe('completed');
  });

  it('rejects a non-numeric race id with 400', async () => {
    const res = await apiRequest('/api/predictions/race/not-a-number');
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: { code: string } };
    expect(error.code).toBe('INVALID_ID');
  });

  it('returns 404 for a race with no prediction', async () => {
    const res = await apiRequest('/api/predictions/race/999999999');
    expect(res.status).toBe(404);
    const { data, error } = (await res.json()) as { data: null; error: { code: string } };
    expect(data).toBeNull();
    expect(error.code).toBe('NOT_FOUND');
  });

  it('returns season history newest-first, scoring the completed round and leaving the pending one open', async () => {
    const res = await apiRequest('/api/predictions/history?year=2099');
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: Array<{ raceId: number; roundNumber: number; correct: boolean | null; actualWinner: { code: string } | null }>;
    };
    expect(data.map((d) => d.roundNumber)).toEqual([1, 2]);

    const completedItem = data.find((d) => d.raceId === completedRaceId)!;
    expect(completedItem.correct).toBe(true);
    expect(completedItem.actualWinner?.code).toBe('AAA');

    const pendingItem = data.find((d) => d.raceId === upcomingRaceId)!;
    expect(pendingItem.correct).toBeNull();
    expect(pendingItem.actualWinner).toBeNull();
  });

  it('aggregates per-season intel standings from the feature rows', async () => {
    const res = await apiRequest('/api/predictions/standings?year=2099');
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: Array<{ driver: { code: string }; overallScore: number; winProbability: string }>;
    };
    expect(data).toHaveLength(2);
    const ace = data.find((r) => r.driver.code === 'AAA')!;
    expect(typeof ace.overallScore).toBe('number');
    expect(Number(ace.winProbability)).toBeCloseTo(0.575);
  });

  it('reports per-season accuracy buckets', async () => {
    const res = await apiRequest('/api/predictions/accuracy');
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: Array<{ year: number; gp: { races: number; correct: number } }>;
    };
    const season = data.find((d) => d.year === 2099)!;
    expect(season.gp.races).toBe(1);
    expect(season.gp.correct).toBe(1);
  });

  it('reports the model version in use', async () => {
    const res = await apiRequest('/api/predictions/model-info');
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { gpVersion: string; sprintVersion: string } };
    expect(data.gpVersion).toBe('weighted-v4');
    expect(data.sprintVersion).toBe('sprint-v2');
  });
});
