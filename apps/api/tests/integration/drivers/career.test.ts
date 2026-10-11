import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { createSeason } from '../../support/factories/season.factory';
import { createTeam } from '../../support/factories/team.factory';
import { createDriver } from '../../support/factories/driver.factory';

interface CareerBody {
  data: Array<{ year: number; driverId: number }>;
}

describe('driver career (integration)', () => {
  const db = getTestDb();
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    await truncateAll(db);
    const older = await createSeason(db, { year: 2081 });
    const newer = await createSeason(db, { year: 2082 });
    const teamOld = await createTeam(db, older.id, { teamKey: 'career-team' });
    const teamNew = await createTeam(db, newer.id, { teamKey: 'career-team' });

    // FastF1 gave the same people different names in different seasons.
    ids.antOld = (await createDriver(db, older.id, teamOld.id, { driverNumber: 12, code: 'ANT', firstName: 'Andrea', lastName: 'Kimi Antonelli' })).id;
    ids.antNew = (await createDriver(db, newer.id, teamNew.id, { driverNumber: 12, code: 'ANT', firstName: 'Kimi', lastName: 'Antonelli' })).id;
    ids.hulOld = (await createDriver(db, older.id, teamOld.id, { driverNumber: 27, code: 'HUL', firstName: 'Nico', lastName: 'Hülkenberg' })).id;
    ids.hulNew = (await createDriver(db, newer.id, teamNew.id, { driverNumber: 27, code: 'HUL', firstName: 'Nico', lastName: 'Hulkenberg' })).id;
    ids.piquetSr = (await createDriver(db, older.id, teamOld.id, { driverNumber: 3, code: 'PIQ', firstName: 'Nelson', lastName: 'Piquet' })).id;
    ids.piquetJr = (await createDriver(db, newer.id, teamNew.id, { driverNumber: 3, code: 'PIQ', firstName: 'Nelson', lastName: 'Piquet Jr.' })).id;
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  const careerYears = async (driverId: number) => {
    const res = await apiRequest(`/api/drivers/${driverId}/career`);
    const { data } = (await res.json()) as CareerBody;
    return data.map((d) => [d.year, d.driverId]);
  };

  it('joins seasons where the driver appears under a longer name', async () => {
    expect(await careerYears(ids.antNew)).toEqual([[2082, ids.antNew], [2081, ids.antOld]]);
    expect(await careerYears(ids.antOld)).toEqual([[2082, ids.antNew], [2081, ids.antOld]]);
  });

  it('joins seasons whose names differ only by accents', async () => {
    expect(await careerYears(ids.hulNew)).toEqual([[2082, ids.hulNew], [2081, ids.hulOld]]);
  });

  it('keeps a father and son with the same name apart', async () => {
    expect(await careerYears(ids.piquetJr)).toEqual([[2082, ids.piquetJr]]);
  });

  it('lists each person once in search, under their latest season', async () => {
    const res = await apiRequest('/api/search');
    const { data } = (await res.json()) as { data: { drivers: Array<{ id: number }> } };
    const found = data.drivers.map((d) => d.id);

    expect(found).toContain(ids.antNew);
    expect(found).not.toContain(ids.antOld);
    expect(found).toContain(ids.hulNew);
    expect(found).not.toContain(ids.hulOld);
    expect(found).toEqual(expect.arrayContaining([ids.piquetSr, ids.piquetJr]));
  });
});
