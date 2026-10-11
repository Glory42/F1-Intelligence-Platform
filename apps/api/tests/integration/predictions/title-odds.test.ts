import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { createSeason } from '../../support/factories/season.factory';
import { createTeam } from '../../support/factories/team.factory';
import { createDriver } from '../../support/factories/driver.factory';
import { createDriverTitleOdds, createTeamTitleOdds } from '../../support/factories/titleOdds.factory';

interface TitleOddsBody {
  data: {
    afterRound: number;
    drivers: Array<{ driver: { code: string }; titleProbability: number }>;
    teams: Array<{ team: { name: string }; titleProbability: number }>;
    history: Array<{ afterRound: number; driverId: number; titleProbability: number }>;
  };
}

describe('title odds (integration)', () => {
  const db = getTestDb();
  let norId: number;

  beforeAll(async () => {
    await truncateAll(db);
    const season = await createSeason(db, { year: 2093 });
    const mcl = await createTeam(db, season.id, { teamKey: 'mclaren', name: 'McLaren' });
    const nor = await createDriver(db, season.id, mcl.id, { driverNumber: 4, code: 'NOR' });
    const pia = await createDriver(db, season.id, mcl.id, { driverNumber: 81, code: 'PIA' });
    norId = nor.id;

    await createDriverTitleOdds(db, season.id, nor.id, { afterRound: 1, titleProbability: '0.40000' });
    await createDriverTitleOdds(db, season.id, pia.id, { afterRound: 1, titleProbability: '0.60000' });
    await createDriverTitleOdds(db, season.id, nor.id, { afterRound: 2, titleProbability: '0.72000' });
    await createDriverTitleOdds(db, season.id, pia.id, { afterRound: 2, titleProbability: '0.28000' });
    await createTeamTitleOdds(db, season.id, mcl.id, { afterRound: 2, titleProbability: '1.00000' });

    const tied = await createSeason(db, { year: 2092 });
    const fer = await createTeam(db, tied.id, { teamKey: 'ferrari', name: 'Ferrari' });
    const lec = await createDriver(db, tied.id, fer.id, { driverNumber: 16, code: 'LEC' });
    const ham = await createDriver(db, tied.id, fer.id, { driverNumber: 44, code: 'HAM' });
    await createDriverTitleOdds(db, tied.id, lec.id, { titleProbability: '0.00000', expectedPoints: '213.0' });
    await createDriverTitleOdds(db, tied.id, ham.id, { titleProbability: '0.00000', expectedPoints: '268.0' });
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it('returns the latest round odds ranked, plus the history for charting', async () => {
    const res = await apiRequest('/api/predictions/title-odds?year=2093');
    const { data } = (await res.json()) as TitleOddsBody;

    expect(data.afterRound).toBe(2);
    expect(data.drivers.map((d) => [d.driver.code, d.titleProbability])).toEqual([['NOR', 0.72], ['PIA', 0.28]]);
    expect(data.teams.map((t) => [t.team.name, t.titleProbability])).toEqual([['McLaren', 1]]);
    expect(data.history.filter((h) => h.driverId === norId).map((h) => [h.afterRound, h.titleProbability])).toEqual([
      [1, 0.4],
      [2, 0.72],
    ]);
  });

  it('orders drivers with equal odds by expected final points', async () => {
    const res = await apiRequest('/api/predictions/title-odds?year=2092');
    const { data } = (await res.json()) as TitleOddsBody;

    expect(data.drivers.map((d) => d.driver.code)).toEqual(['HAM', 'LEC']);
  });
});
