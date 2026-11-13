import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { createSeason } from '../../support/factories/season.factory';
import { createCircuit } from '../../support/factories/circuit.factory';
import { createTeam } from '../../support/factories/team.factory';
import { createDriver } from '../../support/factories/driver.factory';
import { createRace } from '../../support/factories/race.factory';
import { createRaceResult } from '../../support/factories/raceResult.factory';
import { createSprintResult } from '../../support/factories/sprintResult.factory';
import { createLapTimes } from '../../support/factories/lapTime.factory';
import { createSprintLapTimes } from '../../support/factories/sprintLapTime.factory';

interface InsightsBody {
  data: {
    degradation: Array<{
      team: { teamKey: string };
      compound: string;
      msPerLap: number;
      laps: number;
      stints: number;
      points: Array<{ tyreAge: number; lossMs: number }>;
    }>;
  };
}

const LAST_LAP = 11;

// Laps 2..11 on one set: 80 ms a lap of wear, while 55 ms a lap of fuel burns off.
function wornLaps(raceId: number, driverId: number, compound: string, wearMs: number, count = 10) {
  return Array.from({ length: count }, (_, i) => {
    const lapNumber = LAST_LAP - count + 1 + i;
    const tyreLife = i + 1;
    return {
      raceId, driverId, compound, lapNumber, tyreLife, isPitLap: false,
      lapTimeMs: 90_000 + wearMs * tyreLife + 55 * (LAST_LAP - lapNumber),
    };
  });
}

describe('strategy insights (integration)', () => {
  const db = getTestDb();
  let raceId: number;
  let emptyRaceId: number;

  beforeAll(async () => {
    await truncateAll(db);
    const season = await createSeason(db, { year: 2095 });
    const circuit = await createCircuit(db, { circuitKey: 'insights-circuit' });
    const ferrari = await createTeam(db, season.id, { teamKey: 'ferrari', name: 'Ferrari' });
    const mclaren = await createTeam(db, season.id, { teamKey: 'mclaren', name: 'McLaren' });
    const lec = await createDriver(db, season.id, ferrari.id, { driverNumber: 16, code: 'LEC' });
    const pia = await createDriver(db, season.id, mclaren.id, { driverNumber: 81, code: 'PIA' });
    const race = await createRace(db, season.id, circuit.id, { status: 'completed' });
    raceId = race.id;

    await createRaceResult(db, race.id, lec.id, { finishPosition: 1 });
    await createRaceResult(db, race.id, pia.id, { finishPosition: 2 });
    await createLapTimes(db, [
      ...wornLaps(race.id, lec.id, 'MEDIUM', 80),
      // Four laps: too few to fit, so McLaren gets no row.
      ...wornLaps(race.id, pia.id, 'MEDIUM', 40, 4),
    ]);
    await createSprintResult(db, race.id, pia.id, { finishPosition: 1 });
    await createSprintLapTimes(db, wornLaps(race.id, pia.id, 'SOFT', 120));

    const empty = await createRace(db, season.id, circuit.id, { roundNumber: 2, status: 'completed' });
    emptyRaceId = empty.id;
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it("returns each team's fuel-corrected wear per compound", async () => {
    const res = await apiRequest(`/api/races/${raceId}/strategy-insights`);
    const { data } = (await res.json()) as InsightsBody;

    expect(res.status).toBe(200);
    expect(data.degradation).toHaveLength(1);
    expect(data.degradation[0]).toMatchObject({
      team: { teamKey: 'ferrari' }, compound: 'MEDIUM', msPerLap: 80, laps: 10, stints: 1,
    });
    expect(data.degradation[0].points[0]).toEqual({ tyreAge: 2, lossMs: 160 });
  });

  it("reads the sprint's own laps", async () => {
    const res = await apiRequest(`/api/races/${raceId}/strategy-insights?session=sprint`);
    const { data } = (await res.json()) as InsightsBody;

    expect(data.degradation.map((d) => [d.team.teamKey, d.compound, d.msPerLap])).toEqual([['mclaren', 'SOFT', 120]]);
  });

  it('answers a race without laps with an empty list, cached briefly', async () => {
    const res = await apiRequest(`/api/races/${emptyRaceId}/strategy-insights`);
    const { data } = (await res.json()) as InsightsBody;

    expect(data.degradation).toEqual([]);
    expect(res.headers.get('Cache-Control')).not.toContain('immutable');
  });

  it('rejects an unknown session', async () => {
    const res = await apiRequest(`/api/races/${raceId}/strategy-insights?session=qualifying`);

    expect(res.status).toBe(400);
  });
});
