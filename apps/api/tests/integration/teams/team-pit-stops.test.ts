import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { createSeason } from '../../support/factories/season.factory';
import { createCircuit } from '../../support/factories/circuit.factory';
import { createTeam } from '../../support/factories/team.factory';
import { createDriver } from '../../support/factories/driver.factory';
import { createRace } from '../../support/factories/race.factory';
import { createRacePitStop } from '../../support/factories/racePitStop.factory';

interface TeamStopsBody {
  data: Array<{ roundNumber: number; raceName: string; lapNumber: number; stationaryMs: number; driver: { code: string } }>;
}

describe('a team’s pit stops (integration)', () => {
  const db = getTestDb();
  let teamId: number;

  beforeAll(async () => {
    await truncateAll(db);
    const season = await createSeason(db, { year: 2096 });
    const circuit = await createCircuit(db, { circuitKey: 'stops-circuit' });
    const team = await createTeam(db, season.id, { teamKey: 'crew', name: 'Crew' });
    const rival = await createTeam(db, season.id, { teamKey: 'rival', name: 'Rival' });
    teamId = team.id;
    const a = await createDriver(db, season.id, team.id, { driverNumber: 1, code: 'AAA' });
    const b = await createDriver(db, season.id, team.id, { driverNumber: 2, code: 'BBB' });
    const r = await createDriver(db, season.id, rival.id, { driverNumber: 3, code: 'RRR' });
    const round2 = await createRace(db, season.id, circuit.id, { roundNumber: 2, name: 'Second GP', status: 'completed' });
    const round1 = await createRace(db, season.id, circuit.id, { roundNumber: 1, name: 'First GP', status: 'completed' });

    await createRacePitStop(db, round2.id, a.id, { lapNumber: 20, stationaryMs: 2300 });
    await createRacePitStop(db, round1.id, b.id, { lapNumber: 30, stationaryMs: 2600 });
    await createRacePitStop(db, round1.id, a.id, { lapNumber: 15, stationaryMs: 2100 });
    await createRacePitStop(db, round1.id, a.id, { lapNumber: 40, stationaryMs: null });
    await createRacePitStop(db, round1.id, a.id, { lapNumber: 18, stationaryMs: 2500, sessionType: 'sprint' });
    await createRacePitStop(db, round1.id, r.id, { lapNumber: 16, stationaryMs: 1900 });
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it("lists every timed grand prix stop by the team's drivers, in race and lap order", async () => {
    const res = await apiRequest(`/api/teams/${teamId}/pit-stops`);
    const { data } = (await res.json()) as TeamStopsBody;

    expect(data.map((s) => [s.roundNumber, s.raceName, s.driver.code, s.lapNumber, s.stationaryMs])).toEqual([
      [1, 'First GP', 'AAA', 15, 2100],
      [1, 'First GP', 'BBB', 30, 2600],
      [2, 'Second GP', 'AAA', 20, 2300],
    ]);
  });
});
