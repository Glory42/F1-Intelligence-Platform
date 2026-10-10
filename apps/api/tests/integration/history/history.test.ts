import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { createSeason } from '../../support/factories/season.factory';
import { createTeam } from '../../support/factories/team.factory';
import { createDriver } from '../../support/factories/driver.factory';
import {
  createHistoryConstructor, createHistoryConstructorSeason, createHistoryDriver,
} from '../../support/factories/history.factory';

describe('history (integration)', () => {
  const db = getTestDb();
  let perezId: number;
  let redBullId: number;

  beforeAll(async () => {
    await truncateAll(db);
    await createHistoryDriver(db, { f1dbId: 'lewis-hamilton', name: 'Lewis Hamilton', raceWins: 106, championships: 7, polePositions: 104,
      dateOfBirth: '1985-01-07', firstWinDate: '2007-06-10', firstWinName: 'Canadian GP' });
    await createHistoryDriver(db, { f1dbId: 'max-verstappen', name: 'Max Verstappen', raceWins: 72, championships: 4, polePositions: 49,
      dateOfBirth: '1997-09-30', firstWinDate: '2016-05-15', firstWinName: 'Spanish GP' });
    await createHistoryDriver(db, { f1dbId: 'sergio-perez', name: 'Sergio Pérez', matchKey: 'sergio perez', raceWins: 6,
      raceStarts: 281, firstRaceDate: '2011-03-27', firstRaceName: 'Australian GP' });
    await createHistoryConstructor(db, { f1dbId: 'red-bull', name: 'Red Bull', raceWins: 130, championships: 6 });
    await createHistoryConstructorSeason(db, 'red-bull', 2026, 'RB22', 'Red Bull Ford');

    const season = await createSeason(db, { year: 2085 });
    const team = await createTeam(db, season.id, { teamKey: 'red_bull_racing', name: 'Red Bull Racing' });
    redBullId = team.id;
    const perez = await createDriver(db, season.id, team.id, { driverNumber: 11, code: 'PER', firstName: 'Sergio', lastName: 'Perez' });
    perezId = perez.id;
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it('ranks all-time leaders and the youngest winners', async () => {
    const res = await apiRequest('/api/history/records');
    const { data } = (await res.json()) as {
      data: {
        drivers: { wins: Array<{ f1dbId: string; name: string; value: number }>; championships: Array<{ f1dbId: string; name: string; value: number }> };
        youngestWinners: Array<{ f1dbId: string; name: string; ageDays: number; raceName: string }>;
        constructors: { wins: Array<{ f1dbId: string; name: string; value: number }> };
      };
    };

    expect(data.drivers.wins.map((r) => [r.name, r.value]).slice(0, 2)).toEqual([['Lewis Hamilton', 106], ['Max Verstappen', 72]]);
    expect(data.drivers.championships[0]).toEqual({ f1dbId: 'lewis-hamilton', name: 'Lewis Hamilton', value: 7 });
    expect(data.youngestWinners[0]).toEqual({ f1dbId: 'max-verstappen', name: 'Max Verstappen', ageDays: 6802, raceName: 'Spanish GP' });
    expect(data.constructors.wins[0]).toEqual({ f1dbId: 'red-bull', name: 'Red Bull', value: 130 });
  });

  it("finds a core driver's all-time record despite accent differences", async () => {
    const res = await apiRequest(`/api/drivers/${perezId}/history`);
    const { data } = (await res.json()) as { data: { raceStarts: number; firstRaceName: string } };

    expect([data.raceStarts, data.firstRaceName]).toEqual([281, 'Australian GP']);
  });

  it("returns a core team's constructor history with chassis and engine by season", async () => {
    const res = await apiRequest(`/api/teams/${redBullId}/history`);
    const { data } = (await res.json()) as { data: { constructor: { raceWins: number }; seasons: Array<{ year: number; chassis: string; engine: string }> } };

    expect(data.constructor.raceWins).toBe(130);
    expect(data.seasons).toEqual([{ year: 2026, chassis: 'RB22', engine: 'Red Bull Ford' }]);
  });
});
