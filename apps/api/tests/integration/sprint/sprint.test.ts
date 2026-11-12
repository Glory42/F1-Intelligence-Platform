import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { createSeason } from '../../support/factories/season.factory';
import { createCircuit } from '../../support/factories/circuit.factory';
import { createTeam } from '../../support/factories/team.factory';
import { createDriver } from '../../support/factories/driver.factory';
import { createRace } from '../../support/factories/race.factory';
import { createSprintPrediction } from '../../support/factories/sprintPrediction.factory';
import { createSprintResult } from '../../support/factories/sprintResult.factory';
import { createDriverSprintFeatures } from '../../support/factories/driverSprintFeatures.factory';

describe('sprint (integration)', () => {
  const db = getTestDb();
  let sprintRaceId: number;
  let conventionalRaceId: number;

  beforeAll(async () => {
    await truncateAll(db);

    const season = await createSeason(db, { year: 2099 });
    const circuit = await createCircuit(db, { circuitKey: 'sprint-test-circuit', name: 'Sprint Test Circuit' });
    const team = await createTeam(db, season.id);
    const winner = await createDriver(db, season.id, team.id, { driverNumber: 1, code: 'AAA', firstName: 'Ada', lastName: 'Ace' });
    const other = await createDriver(db, season.id, team.id, { driverNumber: 2, code: 'BBB', firstName: 'Ben', lastName: 'Bee' });

    const sprintRace = await createRace(db, season.id, circuit.id, {
      roundNumber: 1, name: 'Sprint GP', raceDate: '2099-05-02', status: 'sprint_qualifying_done',
      eventFormat: 'sprint', sprintDate: new Date('2099-05-01T15:00:00Z'),
    });
    await createSprintPrediction(db, sprintRace.id, winner.id);
    await createDriverSprintFeatures(db, sprintRace.id, winner.id, { winProbability: '0.50000', predictedPosition: 1 });
    await createDriverSprintFeatures(db, sprintRace.id, other.id, { winProbability: '0.30000', predictedPosition: 2 });
    await createSprintResult(db, sprintRace.id, winner.id, { finishPosition: 1, gridPosition: 1 });
    await createSprintResult(db, sprintRace.id, other.id, { finishPosition: 2, gridPosition: 2 });

    const conventional = await createRace(db, season.id, circuit.id, {
      roundNumber: 2, name: 'Plain GP', raceDate: '2099-06-01', status: 'completed', eventFormat: 'conventional',
    });

    sprintRaceId = sprintRace.id;
    conventionalRaceId = conventional.id;
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it('returns the upcoming sprint prediction with every driver row', async () => {
    const res = await apiRequest('/api/sprint/upcoming');
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { predictedWinner: { code: string }; modelVersion: string; race: { hasSprint: boolean }; drivers: Array<{ features: Record<string, unknown> }> };
    };
    expect(data.predictedWinner.code).toBe('AAA');
    expect(data.modelVersion).toBe('sprint-v3');
    expect(data.race.hasSprint).toBe(true);
    expect(data.drivers).toHaveLength(2);
    // sprint-v3 serves weighted-v4's features: the GP's set, scored on the sprint grid.
    expect(Object.keys(data.drivers[0].features)).toEqual([
      'grid', 'qualiPace', 'teamQualiPace', 'driverPoints', 'teammateEdge', 'gridProcessional', 'teamRacePace',
    ]);
  });

  it('returns a sprint prediction by race id', async () => {
    const res = await apiRequest(`/api/sprint/race/${sprintRaceId}`);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { predictedWinner: { code: string } } };
    expect(data.predictedWinner.code).toBe('AAA');
  });

  it('rejects a non-numeric race id with 400', async () => {
    const res = await apiRequest('/api/sprint/race/not-a-number');
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: { code: string } };
    expect(error.code).toBe('INVALID_ID');
  });

  it('returns 404 for a race with no sprint prediction', async () => {
    const res = await apiRequest('/api/sprint/race/999999999');
    expect(res.status).toBe(404);
    const { error } = (await res.json()) as { error: { code: string } };
    expect(error.code).toBe('NOT_FOUND');
  });

  it('returns sprint detail with prediction and finish-ordered results', async () => {
    const res = await apiRequest(`/api/sprint/race/${sprintRaceId}/detail`);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        race: { hasSprint: boolean };
        prediction: { predictedWinner: { code: string } } | null;
        results: Array<{ finishPosition: number | null; driver: { code: string } }>;
        laps: unknown[];
      };
    };
    expect(data.race.hasSprint).toBe(true);
    expect(data.prediction?.predictedWinner.code).toBe('AAA');
    expect(data.results.map((r) => r.finishPosition)).toEqual([1, 2]);
    expect(data.results[0].driver.code).toBe('AAA');
    expect(data.laps).toEqual([]);
  });

  it('returns 404 on sprint detail for a conventional race', async () => {
    const res = await apiRequest(`/api/sprint/race/${conventionalRaceId}/detail`);
    expect(res.status).toBe(404);
    const { error } = (await res.json()) as { error: { code: string } };
    expect(error.code).toBe('NOT_FOUND');
  });
});
