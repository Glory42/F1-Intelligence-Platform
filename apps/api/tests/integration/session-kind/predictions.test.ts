import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { createSeason } from '../../support/factories/season.factory';
import { createCircuit } from '../../support/factories/circuit.factory';
import { createTeam } from '../../support/factories/team.factory';
import { createDriver } from '../../support/factories/driver.factory';
import { createRace } from '../../support/factories/race.factory';
import { createRacePrediction } from '../../support/factories/prediction.factory';
import { createSprintPrediction } from '../../support/factories/sprintPrediction.factory';
import { createDriverPredictionFeatures } from '../../support/factories/driverPredictionFeatures.factory';
import { createDriverSprintFeatures } from '../../support/factories/driverSprintFeatures.factory';

type PredictionBody = {
  data: {
    race: { id: number };
    predictedWinner: { code: string };
    modelVersion: string;
    drivers: Array<{ driver: { code: string }; winProbability: string; predictedPosition: number | null; features: Record<string, string | null> }>;
  };
};

// A sprint weekend after GP qualifying: both its sprint and its grand prix prediction are still ahead.
describe('a prediction for a GP and a sprint (integration)', () => {
  const db = getTestDb();
  let raceId: number;

  beforeAll(async () => {
    await truncateAll(db);
    const season = await createSeason(db, { year: 2094 });
    const circuit = await createCircuit(db, { circuitKey: 'kind-circuit' });
    const team = await createTeam(db, season.id);
    const winner = await createDriver(db, season.id, team.id, { code: 'WIN' });
    const runnerUp = await createDriver(db, season.id, team.id, { code: 'RUN' });
    const race = await createRace(db, season.id, circuit.id, {
      raceDate: '2094-05-03', sprintDate: new Date('2094-05-02T15:00:00Z'), eventFormat: 'sprint', status: 'qualifying_done',
    });
    raceId = race.id;

    await createRacePrediction(db, race.id, winner.id);
    await createSprintPrediction(db, race.id, winner.id);
    // Inserted runner-up first, so the order has to come from the predicted position.
    await createDriverPredictionFeatures(db, race.id, runnerUp.id, { winProbability: '0.30000', predictedPosition: 2 });
    await createDriverPredictionFeatures(db, race.id, winner.id, { winProbability: '0.60000', predictedPosition: 1 });
    await createDriverSprintFeatures(db, race.id, runnerUp.id, { winProbability: '0.30000', predictedPosition: 2 });
    await createDriverSprintFeatures(db, race.id, winner.id, { winProbability: '0.60000', predictedPosition: 1 });
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it.each([
    ['grand prix', '/api/predictions', 'weighted-v3', 'longRunPace'],
    ['sprint', '/api/sprint', 'sprint-v2', 'shortRunPace'],
  ])('assembles the %s prediction: winner, model, ranked drivers and their feature scores', async (_kind, base, model, kindFeature) => {
    const res = await apiRequest(`${base}/race/${raceId}`);
    const { data } = (await res.json()) as PredictionBody;

    expect([data.predictedWinner.code, data.modelVersion]).toEqual(['WIN', model]);
    expect(data.drivers.map((d) => [d.driver.code, d.winProbability, d.predictedPosition])).toEqual([
      ['WIN', '0.60000', 1],
      ['RUN', '0.30000', 2],
    ]);
    expect([data.drivers[0].features.carPerformance, data.drivers[0].features[kindFeature]]).toEqual(['0.80000', '0.65000']);
  });

  it.each([['grand prix', '/api/predictions'], ['sprint', '/api/sprint']])(
    'offers the %s prediction as upcoming while its session is ahead',
    async (_kind, base) => {
      const res = await apiRequest(`${base}/upcoming`);
      const { data } = (await res.json()) as PredictionBody;

      expect(data.race.id).toBe(raceId);
    },
  );
});
