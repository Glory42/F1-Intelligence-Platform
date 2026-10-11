import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { createSeason } from '../../support/factories/season.factory';
import { createCircuit } from '../../support/factories/circuit.factory';
import { createTeam } from '../../support/factories/team.factory';
import { createDriver } from '../../support/factories/driver.factory';
import { createRace } from '../../support/factories/race.factory';
import { createRaceResult } from '../../support/factories/raceResult.factory';
import { createRaceStint } from '../../support/factories/raceStint.factory';
import { createRacePitStop } from '../../support/factories/racePitStop.factory';
import { createLapTimes, stintLaps } from '../../support/factories/lapTime.factory';
import { createSprintResult } from '../../support/factories/sprintResult.factory';

interface StrategyBody {
  data: {
    source: string;
    drivers: Array<{
      driver: { code: string };
      stints: Array<{ stintNumber: number; compound: string; lapStart: number; lapEnd: number; tyreAgeAtStart: number | null }>;
      pitStops: Array<{ lapNumber: number; pitLaneMs: number | null; stationaryMs: number | null }>;
    }>;
  };
}

describe('strategy (integration)', () => {
  const db = getTestDb();
  let raceId: number;
  let legacyRaceId: number;

  beforeAll(async () => {
    await truncateAll(db);
    const season = await createSeason(db, { year: 2096 });
    const circuit = await createCircuit(db, { circuitKey: 'strategy-circuit' });
    const team = await createTeam(db, season.id);
    const lec = await createDriver(db, season.id, team.id, { driverNumber: 16, code: 'LEC' });
    const pia = await createDriver(db, season.id, team.id, { driverNumber: 81, code: 'PIA' });
    const race = await createRace(db, season.id, circuit.id, { status: 'completed' });
    raceId = race.id;

    await createRaceResult(db, race.id, pia.id, { finishPosition: 2 });
    await createRaceResult(db, race.id, lec.id, { finishPosition: 1 });
    await createRaceStint(db, race.id, lec.id, { stintNumber: 2, compound: 'HARD', lapStart: 16, lapEnd: 53 });
    await createRaceStint(db, race.id, lec.id, { stintNumber: 1, compound: 'MEDIUM', lapStart: 1, lapEnd: 15 });
    await createRaceStint(db, race.id, pia.id, { stintNumber: 1, compound: 'MEDIUM', lapStart: 1, lapEnd: 53 });
    await createRacePitStop(db, race.id, lec.id, { lapNumber: 15, stationaryMs: null });
    await createSprintResult(db, race.id, lec.id, { finishPosition: 2 });
    await createSprintResult(db, race.id, pia.id, { finishPosition: 1 });
    await createRaceStint(db, race.id, pia.id, { sessionType: 'sprint', compound: 'SOFT', lapStart: 1, lapEnd: 19 });

    const legacy = await createRace(db, season.id, circuit.id, { roundNumber: 2, status: 'completed' });
    legacyRaceId = legacy.id;
    await createRaceResult(db, legacy.id, lec.id, { finishPosition: 1 });
    // Accurate laps only: lap 1, the lap-15 in-lap and lap-16 out-lap are missing, as in real lap_times.
    await createLapTimes(db, [
      ...stintLaps(legacy.id, lec.id, 1, 'MEDIUM', [2, 14]),
      ...stintLaps(legacy.id, lec.id, 2, 'HARD', [17, 53]),
    ]);
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it("returns each driver's stints and stops in finishing order", async () => {
    const res = await apiRequest(`/api/races/${raceId}/strategy`);
    const { data } = (await res.json()) as StrategyBody;

    expect(data.source).toBe('openf1');
    expect(data.drivers.map((d) => d.driver.code)).toEqual(['LEC', 'PIA']);
    expect(data.drivers[0].stints.map((s) => [s.compound, s.lapStart, s.lapEnd])).toEqual([
      ['MEDIUM', 1, 15],
      ['HARD', 16, 53],
    ]);
    expect(data.drivers[0].pitStops).toEqual([{ lapNumber: 15, pitLaneMs: 22000, stationaryMs: null }]);
  });

  it('rebuilds approximate stints from lap times when OpenF1 has none', async () => {
    const res = await apiRequest(`/api/races/${legacyRaceId}/strategy`);
    const { data } = (await res.json()) as StrategyBody;

    expect(data.source).toBe('derived');
    expect(data.drivers[0].stints).toEqual([
      { stintNumber: 1, compound: 'MEDIUM', lapStart: 2, lapEnd: 14, tyreAgeAtStart: null },
      { stintNumber: 2, compound: 'HARD', lapStart: 17, lapEnd: 53, tyreAgeAtStart: null },
    ]);
  });

  it("returns the sprint's stints in sprint finishing order", async () => {
    const res = await apiRequest(`/api/races/${raceId}/strategy?session=sprint`);
    const { data } = (await res.json()) as StrategyBody;

    expect(data.drivers.map((d) => d.driver.code)).toEqual(['PIA', 'LEC']);
    expect(data.drivers[0].stints.map((s) => s.compound)).toEqual(['SOFT']);
    expect(data.drivers[1].stints).toEqual([]);
  });
});
