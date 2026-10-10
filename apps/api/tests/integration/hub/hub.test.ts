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
import { createRacePitStop } from '../../support/factories/racePitStop.factory';
import { createBattle } from '../../support/factories/raceStory.factory';

describe('home hub (integration)', () => {
  const db = getTestDb();
  let raceId: number;

  beforeAll(async () => {
    await truncateAll(db);
    const season = await createSeason(db, { year: 2084 });
    const circuit = await createCircuit(db, { circuitKey: 'hub-circuit' });
    const team = await createTeam(db, season.id);
    const lec = await createDriver(db, season.id, team.id, { driverNumber: 16, code: 'LEC' });
    const pia = await createDriver(db, season.id, team.id, { driverNumber: 81, code: 'PIA' });
    const race = await createRace(db, season.id, circuit.id, { name: 'Hub Grand Prix', raceDate: '2084-09-01', status: 'completed' });
    raceId = race.id;
    await createRaceResult(db, race.id, lec.id, { finishPosition: 1 });
    await createRaceResult(db, race.id, pia.id, { finishPosition: 2 });
    await createRacePrediction(db, race.id, pia.id);
    await createRacePitStop(db, race.id, lec.id, { lapNumber: 15, stationaryMs: 2_900 });
    await createRacePitStop(db, race.id, pia.id, { lapNumber: 17, stationaryMs: 2_150 });
    await createBattle(db, race.id, pia.id, lec.id, { lapStart: 40, lapEnd: 53, minGapMs: 310 });
    await createBattle(db, race.id, lec.id, pia.id, { lapStart: 1, lapEnd: 3, minGapMs: 500 });

    const older = await createRace(db, season.id, circuit.id, { roundNumber: 2, name: 'Older Grand Prix', raceDate: '2064-09-01', status: 'completed' });
    await createRaceResult(db, older.id, pia.id, { finishPosition: 1 });
    await createRace(db, season.id, circuit.id, { roundNumber: 3, name: 'Other Day Grand Prix', raceDate: '2070-07-04', status: 'completed' });
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it('recaps a race: winner, the model pick, fastest stop and the longest battle', async () => {
    const res = await apiRequest(`/api/races/${raceId}/recap`);
    const { data } = (await res.json()) as {
      data: {
        winner: { code: string }; predictedWinner: { code: string }; predictionHit: boolean;
        fastestStop: { driver: { code: string }; stationaryMs: number };
        topBattle: { chaser: { code: string }; lapStart: number; lapEnd: number };
      };
    };

    expect([data.winner.code, data.predictedWinner.code, data.predictionHit]).toEqual(['LEC', 'PIA', false]);
    expect([data.fastestStop.driver.code, data.fastestStop.stationaryMs]).toEqual(['PIA', 2150]);
    expect([data.topBattle.chaser.code, data.topBattle.lapStart, data.topBattle.lapEnd]).toEqual(['PIA', 40, 53]);
  });

  it('lists races held on the same calendar day in earlier seasons, newest first', async () => {
    const res = await apiRequest('/api/history/on-this-day?date=09-01');
    const { data } = (await res.json()) as { data: Array<{ name: string; year: number; winner: { code: string } | null }> };

    expect(data.map((r) => [r.year, r.name, r.winner?.code ?? null])).toEqual([
      [2084, 'Hub Grand Prix', 'LEC'],
      [2064, 'Older Grand Prix', 'PIA'],
    ]);
  });
});
