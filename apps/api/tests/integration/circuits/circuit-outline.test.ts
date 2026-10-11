import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { createSeason } from '../../support/factories/season.factory';
import { createCircuit } from '../../support/factories/circuit.factory';
import { createTeam } from '../../support/factories/team.factory';
import { createDriver } from '../../support/factories/driver.factory';
import { createRace } from '../../support/factories/race.factory';
import { createLapTelemetry } from '../../support/factories/lapTelemetry.factory';

describe('circuit outline (integration)', () => {
  const db = getTestDb();

  beforeAll(async () => {
    await truncateAll(db);
    const season = await createSeason(db, { year: 2086 });
    await createCircuit(db, { circuitKey: 'no-telemetry-circuit' });
    const circuit = await createCircuit(db, { circuitKey: 'outline-circuit' });
    const team = await createTeam(db, season.id);
    const pole = await createDriver(db, season.id, team.id, { driverNumber: 1, code: 'POL' });
    const race = await createRace(db, season.id, circuit.id, { status: 'completed' });
    await createLapTelemetry(db, race.id, pole.id);
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it('draws the circuit from the latest stored pole lap', async () => {
    const res = await apiRequest('/api/races/circuit/outline-circuit');
    const { data } = (await res.json()) as { data: { outlinePath: string | null } };

    expect(data.outlinePath).toBe('M0,1000L1000,1000L1000,0L0,0Z');
  });

  it('has no outline for a circuit without telemetry', async () => {
    const res = await apiRequest('/api/races/circuit/no-telemetry-circuit');
    const { data } = (await res.json()) as { data: { outlinePath: string | null } };

    expect(data.outlinePath).toBeNull();
  });
});
