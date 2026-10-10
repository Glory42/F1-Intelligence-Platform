import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { createSeason } from '../../support/factories/season.factory';
import { createCircuit } from '../../support/factories/circuit.factory';
import { createTeam } from '../../support/factories/team.factory';
import { createDriver } from '../../support/factories/driver.factory';
import { createRace } from '../../support/factories/race.factory';
import { createRaceOvertake } from '../../support/factories/raceOvertake.factory';

interface RacecraftBody {
  data: Array<{ driver: { code: string }; made: number; suffered: number; net: number }>;
}

describe('racecraft leaderboard (integration)', () => {
  const db = getTestDb();

  beforeAll(async () => {
    await truncateAll(db);
    const season = await createSeason(db, { year: 2091 });
    const circuit = await createCircuit(db, { circuitKey: 'racecraft-circuit' });
    const team = await createTeam(db, season.id);
    const a = await createDriver(db, season.id, team.id, { driverNumber: 1, code: 'AAA' });
    const b = await createDriver(db, season.id, team.id, { driverNumber: 2, code: 'BBB' });
    const c = await createDriver(db, season.id, team.id, { driverNumber: 3, code: 'CCC' });
    const race = await createRace(db, season.id, circuit.id, { status: 'completed' });

    for (const minute of [1, 2, 3]) {
      await createRaceOvertake(db, race.id, a.id, b.id, { date: new Date(`2091-03-01T14:0${minute}:00Z`) });
    }
    await createRaceOvertake(db, race.id, b.id, a.id, { date: new Date('2091-03-01T14:05:00Z') });
    await createRaceOvertake(db, race.id, c.id, a.id, { date: new Date('2091-02-28T15:05:00Z'), sessionType: 'sprint' });
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it('ranks drivers by net grand prix overtakes, excluding sprint passes', async () => {
    const res = await apiRequest('/api/drivers/racecraft?year=2091');
    const { data } = (await res.json()) as RacecraftBody;

    expect(data.map((r) => [r.driver.code, r.made, r.suffered, r.net])).toEqual([
      ['AAA', 3, 1, 2],
      ['BBB', 1, 3, -2],
    ]);
  });
});
