import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { createSeason } from '../../support/factories/season.factory';
import { createCircuit } from '../../support/factories/circuit.factory';
import { createTeam } from '../../support/factories/team.factory';
import { createDriver } from '../../support/factories/driver.factory';
import { createRace } from '../../support/factories/race.factory';
import { createRacePitStop } from '../../support/factories/racePitStop.factory';

interface LeaderboardBody {
  data: Array<{ team: { name: string }; stops: number; medianStationaryMs: number; fastestStationaryMs: number }>;
}

describe('team pit-stop leaderboard (integration)', () => {
  const db = getTestDb();

  beforeAll(async () => {
    await truncateAll(db);
    const season = await createSeason(db, { year: 2095 });
    const circuit = await createCircuit(db, { circuitKey: 'pit-circuit' });
    const quick = await createTeam(db, season.id, { teamKey: 'quick', name: 'Quick Crew' });
    const slow = await createTeam(db, season.id, { teamKey: 'slow', name: 'Slow Crew' });
    const q1 = await createDriver(db, season.id, quick.id, { driverNumber: 1, code: 'QQA' });
    const s1 = await createDriver(db, season.id, slow.id, { driverNumber: 2, code: 'SSA' });
    const race = await createRace(db, season.id, circuit.id, { status: 'completed' });

    await createRacePitStop(db, race.id, q1.id, { lapNumber: 10, stationaryMs: 2900 });
    await createRacePitStop(db, race.id, q1.id, { lapNumber: 30, stationaryMs: 2100 });
    await createRacePitStop(db, race.id, q1.id, { lapNumber: 45, stationaryMs: 2400 });
    await createRacePitStop(db, race.id, q1.id, { lapNumber: 50, stationaryMs: null });
    await createRacePitStop(db, race.id, s1.id, { lapNumber: 12, stationaryMs: 2600 });
    await createRacePitStop(db, race.id, s1.id, { lapNumber: 33, stationaryMs: 3000 });
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it('ranks crews by median stationary time, ignoring stops without one', async () => {
    const res = await apiRequest('/api/teams/pit-stops?year=2095');
    const { data } = (await res.json()) as LeaderboardBody;

    expect(data.map((r) => [r.team.name, r.stops, r.medianStationaryMs, r.fastestStationaryMs])).toEqual([
      ['Quick Crew', 3, 2400, 2100],
      ['Slow Crew', 2, 2800, 2600],
    ]);
  });
});
