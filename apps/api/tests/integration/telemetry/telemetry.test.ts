import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { createSeason } from '../../support/factories/season.factory';
import { createCircuit } from '../../support/factories/circuit.factory';
import { createTeam } from '../../support/factories/team.factory';
import { createDriver } from '../../support/factories/driver.factory';
import { createRace } from '../../support/factories/race.factory';
import { createLapTelemetry } from '../../support/factories/lapTelemetry.factory';

interface TelemetryBody {
  data: {
    drivers: Array<{ driver: { code: string }; lapTimeMs: number }>;
    laps: Array<{ driver: { code: string }; lapTimeMs: number; samples: { speed: number[] } }>;
  };
}

describe('qualifying telemetry (integration)', () => {
  const db = getTestDb();
  let raceId: number;

  beforeAll(async () => {
    await truncateAll(db);
    const season = await createSeason(db, { year: 2087 });
    const circuit = await createCircuit(db, { circuitKey: 'telemetry-circuit' });
    const team = await createTeam(db, season.id);
    const nor = await createDriver(db, season.id, team.id, { driverNumber: 4, code: 'NOR' });
    const pia = await createDriver(db, season.id, team.id, { driverNumber: 81, code: 'PIA' });
    const rus = await createDriver(db, season.id, team.id, { driverNumber: 63, code: 'RUS' });
    const race = await createRace(db, season.id, circuit.id, { status: 'completed' });
    raceId = race.id;
    await createLapTelemetry(db, race.id, rus.id, { lapTimeMs: 79440 });
    await createLapTelemetry(db, race.id, nor.id, { lapTimeMs: 79327 });
    await createLapTelemetry(db, race.id, pia.id, { lapTimeMs: 79436 });
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it('lists every driver with telemetry but returns samples only for the two requested', async () => {
    const res = await apiRequest(`/api/races/${raceId}/telemetry?a=RUS&b=NOR`);
    const { data } = (await res.json()) as TelemetryBody;

    expect(data.drivers.map((d) => [d.driver.code, d.lapTimeMs])).toEqual([['NOR', 79327], ['PIA', 79436], ['RUS', 79440]]);
    expect(data.laps.map((l) => l.driver.code)).toEqual(['RUS', 'NOR']);
    expect(data.laps[0].samples.speed).toEqual([300, 310, 320, 330]);
  });

  it('compares the two fastest laps when no drivers are requested', async () => {
    const res = await apiRequest(`/api/races/${raceId}/telemetry`);
    const { data } = (await res.json()) as TelemetryBody;

    expect(data.laps.map((l) => l.driver.code)).toEqual(['NOR', 'PIA']);
  });
});
