import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { createSeason } from '../../support/factories/season.factory';
import { createCircuit } from '../../support/factories/circuit.factory';
import { createTeam } from '../../support/factories/team.factory';
import { createDriver } from '../../support/factories/driver.factory';
import { createRace } from '../../support/factories/race.factory';
import { createLapTelemetry, squareLap } from '../../support/factories/lapTelemetry.factory';
import { createQualifyingResult } from '../../support/factories/qualifying.factory';

interface CircuitTelemetryBody {
  data: {
    year: number; raceName: string; lapTimeMs: number; isPoleLap: boolean; driver: { code: string };
    profile: { topSpeedKph: number; fullThrottlePct: number };
    trace: { distanceM: number[]; speed: number[] };
  } | null;
}

describe('circuit telemetry (integration)', () => {
  const db = getTestDb();

  beforeAll(async () => {
    await truncateAll(db);
    const older = await createSeason(db, { year: 2097 });
    const newer = await createSeason(db, { year: 2098 });
    const circuit = await createCircuit(db, { circuitKey: 'tele-circuit' });
    await createCircuit(db, { circuitKey: 'quiet-circuit' });
    const teamOld = await createTeam(db, older.id, { teamKey: 'tele-team' });
    const teamNew = await createTeam(db, newer.id, { teamKey: 'tele-team' });
    const oldDriver = await createDriver(db, older.id, teamOld.id, { driverNumber: 1, code: 'OLD' });
    const pole = await createDriver(db, newer.id, teamNew.id, { driverNumber: 2, code: 'POL' });
    const slower = await createDriver(db, newer.id, teamNew.id, { driverNumber: 3, code: 'SLO' });
    const oldRace = await createRace(db, older.id, circuit.id, { raceDate: '2097-05-01', name: 'Old GP' });
    const newRace = await createRace(db, newer.id, circuit.id, { raceDate: '2098-05-01', name: 'New GP' });

    await createLapTelemetry(db, oldRace.id, oldDriver.id, { lapTimeMs: 70_000 });
    // SLO set a faster Q2 lap, but POL took pole — the pole lap is the one to profile.
    await createLapTelemetry(db, newRace.id, slower.id, { lapTimeMs: 79_500 });
    await createQualifyingResult(db, newRace.id, pole.id, { gridPosition: 1 });
    await createQualifyingResult(db, newRace.id, slower.id, { gridPosition: 2 });
    await createLapTelemetry(db, newRace.id, pole.id, { lapTimeMs: 80_000 });
    await createLapTelemetry(db, newRace.id, pole.id, { lapTimeMs: 60_000, sessionType: 'SQ' });
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it("profiles the pole lap from the circuit's latest race", async () => {
    const res = await apiRequest('/api/races/circuit/tele-circuit/telemetry');
    const { data } = (await res.json()) as CircuitTelemetryBody;

    expect([data?.year, data?.raceName, data?.driver.code, data?.lapTimeMs, data?.isPoleLap]).toEqual([2098, 'New GP', 'POL', 80_000, true]);
    expect(data?.profile.topSpeedKph).toBe(Math.max(...squareLap.speed));
    expect(data?.profile.fullThrottlePct).toBe(100);
    expect(data?.trace.distanceM.length).toBe(data?.trace.speed.length);
  });

  it('is empty for a circuit without telemetry', async () => {
    const res = await apiRequest('/api/races/circuit/quiet-circuit/telemetry');
    expect(res.status).toBe(200);
    expect(((await res.json()) as CircuitTelemetryBody).data).toBeNull();
  });
});
