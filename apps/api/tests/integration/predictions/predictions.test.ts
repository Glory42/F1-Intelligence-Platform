import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { createSeason } from '../../support/factories/season.factory';
import { createCircuit } from '../../support/factories/circuit.factory';
import { createTeam } from '../../support/factories/team.factory';
import { createDriver } from '../../support/factories/driver.factory';
import { createRace } from '../../support/factories/race.factory';
import { createRaceResult } from '../../support/factories/raceResult.factory';
import { createQualifyingResult } from '../../support/factories/qualifying.factory';
import { createPreQualiPrediction } from '../../support/factories/preQualiPrediction.factory';
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
    await createDriverPredictionFeatures(db, upcoming.id, winner.id, {
      winProbability: '0.55000', predictedPosition: 1,
      podiumProbability: '0.81000',
    });
    await createDriverPredictionFeatures(db, upcoming.id, other.id, { winProbability: '0.20000', predictedPosition: 2 });
    await createPreQualiPrediction(db, upcoming.id, winner.id, { winProbability: '0.35000', predictedPosition: 1 });

    // The round after: no qualifying yet, so only the forecast before qualifying exists.
    const later = await createRace(db, season.id, circuit.id, {
      roundNumber: 3, name: 'Later GP', raceDate: '2099-04-01', status: 'scheduled',
    });
    await createPreQualiPrediction(db, later.id, other.id, { winProbability: '0.40000', predictedPosition: 1 });
    await createPreQualiPrediction(db, later.id, winner.id, { winProbability: '0.25000', predictedPosition: 2 });

    // Completed prior round with a correct prediction: feeds history + accuracy.
    const completed = await createRace(db, season.id, circuit.id, {
      roundNumber: 2, name: 'Completed GP', raceDate: '2099-02-01', status: 'completed',
    });
    await createRacePrediction(db, completed.id, winner.id);
    await createDriverPredictionFeatures(db, completed.id, winner.id, { winProbability: '0.60000', predictedPosition: 1 });
    await createDriverPredictionFeatures(db, completed.id, other.id, { winProbability: '0.15000', predictedPosition: 2 });
    await createRaceResult(db, completed.id, winner.id, { finishPosition: 1, gridPosition: 1 });
    await createRaceResult(db, completed.id, other.id, { finishPosition: 2, gridPosition: 2 });
    await createQualifyingResult(db, completed.id, other.id, { gridPosition: 1 });
    await createQualifyingResult(db, completed.id, winner.id, { gridPosition: 2 });

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
        drivers: Array<{
          features: Record<string, { value: number; contribution: number }>;
          podiumProbability: string | null; preQualiProbability: string | null;
        }>;
      };
    };
    expect(data.predictedWinner.code).toBe('AAA');
    expect(data.modelVersion).toBe('weighted-v4');
    expect(data.race.status).toBe('qualifying_done');
    expect(data.drivers).toHaveLength(2);
    expect(data.drivers[0].features.teamRacePace).toEqual({ value: -0.15, contribution: 0.35 });
    expect(data.drivers[0].podiumProbability).toBe('0.81000');
    expect(data.drivers[1].podiumProbability).toBeNull();
    // Qualifying moved AAA from 35% to 55%; BBB had no forecast before qualifying.
    expect(data.drivers.map((d) => d.preQualiProbability)).toEqual(['0.35000', null]);
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

  it('scores the whole field of every completed GP against the baselines', async () => {
    const res = await apiRequest('/api/predictions/accuracy');
    const { data } = (await res.json()) as {
      data: Array<{
        year: number;
        calibration: {
          races: number; poleWinRate: number; bins: Array<{ from: number; predictions: number; wins: number }>;
          model: { brier: number; logLoss: number }; pole: { brier: number }; uniform: { brier: number };
        } | null;
      }>;
    };
    const { calibration } = data.find((d) => d.year === 2099)!;

    // Only the completed round counts: AAA at 0.60 won, BBB at 0.15 on pole didn't.
    expect(calibration!.races).toBe(1);
    expect(calibration!.model.brier).toBeCloseTo(0.4 ** 2 + 0.15 ** 2, 4);
    expect(calibration!.model.logLoss).toBeCloseTo(-Math.log(0.6), 4);
    expect(calibration!.poleWinRate).toBe(0);
    expect(calibration!.uniform.brier).toBeCloseTo(0.5, 4);
    expect(calibration!.bins.map((b) => [b.from, b.predictions, b.wins])).toEqual([[0.1, 1, 0], [0.6, 1, 1]]);
  });

  it('serves the next race still before qualifying with its forecast, favourite first', async () => {
    const res = await apiRequest('/api/predictions/pre-quali/upcoming');
    const { data } = (await res.json()) as {
      data: { race: { name: string }; modelVersion: string; drivers: Array<{ driver: { code: string }; winProbability: string }> };
    };

    expect(res.status).toBe(200);
    expect(data.race.name).toBe('Later GP');
    expect(data.modelVersion).toBe('pre-quali-v1');
    expect(data.drivers.map((d) => [d.driver.code, d.winProbability])).toEqual([['BBB', '0.40000'], ['AAA', '0.25000']]);
  });

  it('reports the model version in use', async () => {
    const res = await apiRequest('/api/predictions/model-info');
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { gpVersion: string; sprintVersion: string } };
    expect(data.gpVersion).toBe('weighted-v4');
    expect(data.sprintVersion).toBe('sprint-v3');
  });
});
