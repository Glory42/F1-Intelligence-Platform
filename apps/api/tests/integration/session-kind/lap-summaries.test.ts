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

type Lap = { driverId: number; lapNumber: number; lapTimeMs: number | null; isPitLap: boolean };
type LapsBody = { data: { laps: Array<{ driver: { code: string }; fastestLapMs: number | null; avgLapMs: number | null; totalLaps: number }> } };

// Each driver: two clean laps, a slow pit lap and a lap without a time.
const lapsFor = (driverId: number, base: number): Lap[] => [
  { driverId, lapNumber: 1, lapTimeMs: base + 1000, isPitLap: false },
  { driverId, lapNumber: 2, lapTimeMs: base, isPitLap: false },
  { driverId, lapNumber: 3, lapTimeMs: base + 20_000, isPitLap: true },
  { driverId, lapNumber: 4, lapTimeMs: null, isPitLap: false },
];

describe('lap summaries for a GP and a sprint (integration)', () => {
  const db = getTestDb();
  let raceId: number;

  beforeAll(async () => {
    await truncateAll(db);
    const season = await createSeason(db, { year: 2093 });
    const circuit = await createCircuit(db, { circuitKey: 'laps-circuit' });
    const team = await createTeam(db, season.id);
    const slow = await createDriver(db, season.id, team.id, { code: 'SLO' });
    const fast = await createDriver(db, season.id, team.id, { code: 'FST' });
    const race = await createRace(db, season.id, circuit.id, { eventFormat: 'sprint', status: 'completed' });
    raceId = race.id;

    for (const [driver, position] of [[fast, 1], [slow, 2]] as const) {
      await createRaceResult(db, race.id, driver.id, { finishPosition: position });
      await createSprintResult(db, race.id, driver.id, { finishPosition: position });
    }
    const laps = [...lapsFor(slow.id, 92_000), ...lapsFor(fast.id, 90_000)].map((l) => ({ raceId: race.id, ...l }));
    await createLapTimes(db, laps);
    await createSprintLapTimes(db, laps);
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it.each([
    ['grand prix', (id: number) => `/api/races/${id}`],
    ['sprint', (id: number) => `/api/sprint/race/${id}/detail`],
  ])('summarises the %s laps without pit laps or untimed laps, fastest first', async (_kind, path) => {
    const res = await apiRequest(path(raceId));
    const { data } = (await res.json()) as LapsBody;

    expect(data.laps.map((l) => [l.driver.code, l.fastestLapMs, l.avgLapMs, l.totalLaps])).toEqual([
      ['FST', 90_000, 90_500, 2],
      ['SLO', 92_000, 92_500, 2],
    ]);
  });
});
