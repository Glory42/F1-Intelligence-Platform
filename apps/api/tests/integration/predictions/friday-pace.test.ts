import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { createSeason } from '../../support/factories/season.factory';
import { createCircuit } from '../../support/factories/circuit.factory';
import { createTeam } from '../../support/factories/team.factory';
import { createDriver } from '../../support/factories/driver.factory';
import { createRace } from '../../support/factories/race.factory';
import { createFp2LongRun } from '../../support/factories/fp2LongRun.factory';

interface FridayPaceBody {
  data: Array<{ driver: { code: string }; compound: string; medianLapMs: number; deltaToFastestMs: number }>;
}

describe('friday long-run pace (integration)', () => {
  const db = getTestDb();
  let raceId: number;

  beforeAll(async () => {
    await truncateAll(db);
    const season = await createSeason(db, { year: 2094 });
    const circuit = await createCircuit(db, { circuitKey: 'friday-circuit' });
    const team = await createTeam(db, season.id);
    const ver = await createDriver(db, season.id, team.id, { driverNumber: 1, code: 'VER' });
    const nor = await createDriver(db, season.id, team.id, { driverNumber: 4, code: 'NOR' });
    const race = await createRace(db, season.id, circuit.id, { status: 'qualifying_done' });
    raceId = race.id;

    await createFp2LongRun(db, race.id, ver.id, { compound: 'MEDIUM', medianLapMs: 84350 });
    await createFp2LongRun(db, race.id, ver.id, { compound: 'HARD', medianLapMs: 84900 });
    await createFp2LongRun(db, race.id, nor.id, { compound: 'MEDIUM', medianLapMs: 84120 });
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it("ranks each driver's best long run with the gap to the fastest", async () => {
    const res = await apiRequest(`/api/predictions/race/${raceId}/friday-pace`);
    const { data } = (await res.json()) as FridayPaceBody;

    expect(data.map((r) => [r.driver.code, r.compound, r.medianLapMs, r.deltaToFastestMs])).toEqual([
      ['NOR', 'MEDIUM', 84120, 0],
      ['VER', 'MEDIUM', 84350, 230],
    ]);
  });
});
