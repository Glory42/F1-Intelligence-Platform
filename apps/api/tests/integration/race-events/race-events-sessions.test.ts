import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { createSeason } from '../../support/factories/season.factory';
import { createCircuit } from '../../support/factories/circuit.factory';
import { createTeam } from '../../support/factories/team.factory';
import { createDriver } from '../../support/factories/driver.factory';
import { createRace } from '../../support/factories/race.factory';
import { createRaceOvertake } from '../../support/factories/raceOvertake.factory';

describe('race-events sessions (integration)', () => {
  const db = getTestDb();
  let raceId: number;

  beforeAll(async () => {
    await truncateAll(db);
    const season = await createSeason(db, { year: 2097 });
    const circuit = await createCircuit(db, { circuitKey: 'sprint-weekend-circuit' });
    const team = await createTeam(db, season.id);
    const a = await createDriver(db, season.id, team.id, { driverNumber: 1, code: 'AAA' });
    const b = await createDriver(db, season.id, team.id, { driverNumber: 2, code: 'BBB' });
    const race = await createRace(db, season.id, circuit.id, { eventFormat: 'sprint', status: 'completed' });
    raceId = race.id;

    await createRaceOvertake(db, race.id, a.id, b.id, { date: new Date('2097-03-01T14:05:00Z'), sessionType: 'sprint' });
    await createRaceOvertake(db, race.id, b.id, a.id, { date: new Date('2097-03-02T14:05:00Z'), sessionType: 'race' });
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it('returns only the sprint session overtakes when asked for the sprint', async () => {
    const res = await apiRequest(`/api/races/${raceId}/overtakes?session=sprint`);
    const { data } = (await res.json()) as { data: Array<{ date: string }> };

    expect(data.map((o) => o.date)).toEqual(['2097-03-01T14:05:00.000Z']);
  });
});
