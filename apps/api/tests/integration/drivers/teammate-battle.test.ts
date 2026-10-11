import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { createSeason } from '../../support/factories/season.factory';
import { createCircuit } from '../../support/factories/circuit.factory';
import { createTeam } from '../../support/factories/team.factory';
import { createDriver } from '../../support/factories/driver.factory';
import { createRace } from '../../support/factories/race.factory';
import { createRaceResult } from '../../support/factories/raceResult.factory';
import { createQualifyingResult } from '../../support/factories/qualifying.factory';

interface BattleBody {
  data: {
    teammate: { code: string } | null;
    qualifying: { driver: number; teammate: number };
    race: { driver: number; teammate: number };
    points: { driver: number; teammate: number };
    medianQualiGapMs: number | null;
    races: Array<{
      raceId: number;
      roundNumber: number;
      raceName: string;
      qualiGapMs: number | null;
      driver: { qualiPosition: number | null; finishPosition: number | null; status: string | null; points: number };
      teammate: { qualiPosition: number | null; finishPosition: number | null; status: string | null; points: number };
    }>;
  };
}

describe('teammate battle (integration)', () => {
  const db = getTestDb();
  let driverId: number;

  beforeAll(async () => {
    await truncateAll(db);
    const season = await createSeason(db, { year: 2092 });
    const circuit = await createCircuit(db, { circuitKey: 'battle-circuit' });
    const team = await createTeam(db, season.id, { teamKey: 'battle-team' });
    const rival = await createTeam(db, season.id, { teamKey: 'rival-team' });
    const a = await createDriver(db, season.id, team.id, { driverNumber: 1, code: 'AAA' });
    const b = await createDriver(db, season.id, team.id, { driverNumber: 2, code: 'BBB' });
    const c = await createDriver(db, season.id, rival.id, { driverNumber: 3, code: 'CCC' });
    driverId = a.id;

    // Q3 gaps -200 and +200, then BBB went out in Q2 so the gap falls back to Q2: -100.
    const weekends = [
      { quali: [3, 4], q3: [79_000, 79_200], race: [[2, 'Finished', '18'], [6, 'Finished', '8']] },
      { quali: [5, 4], q3: [79_300, 79_100], race: [[1, 'Finished', '25'], [3, 'Finished', '15']] },
      { quali: [2, 6], q3: [78_900, null], race: [[5, 'Finished', '10'], [18, 'Retired', '0']] },
    ] as const;
    // Created out of round order to prove the per-race list is sorted by round.
    for (const [i, w] of [...weekends.entries()].reverse()) {
      const race = await createRace(db, season.id, circuit.id, { roundNumber: i + 1, name: `Round ${i + 1} Grand Prix`, status: 'completed' });
      await createQualifyingResult(db, race.id, a.id, { gridPosition: w.quali[0], q2TimeMs: 79_500, q3TimeMs: w.q3[0] });
      await createQualifyingResult(db, race.id, b.id, { gridPosition: w.quali[1], q2TimeMs: 79_600, q3TimeMs: w.q3[1] });
      await createRaceResult(db, race.id, a.id, { finishPosition: w.race[0][0], status: w.race[0][1], points: w.race[0][2] });
      await createRaceResult(db, race.id, b.id, { finishPosition: w.race[1][0], status: w.race[1][1], points: w.race[1][2] });
      await createRaceResult(db, race.id, c.id, { finishPosition: 1 + i, status: 'Finished', points: '25' });
    }
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it('scores qualifying, race and points head-to-head against the team-mate', async () => {
    const res = await apiRequest(`/api/drivers/${driverId}/teammate-battle?year=2092`);
    const { data } = (await res.json()) as BattleBody;

    expect(data.teammate?.code).toBe('BBB');
    expect(data.qualifying).toEqual({ driver: 2, teammate: 1 });
    expect(data.race).toEqual({ driver: 2, teammate: 0 });
    expect(data.points).toEqual({ driver: 53, teammate: 23 });
  });

  it('lists every shared race in round order with both drivers and the qualifying gap', async () => {
    const res = await apiRequest(`/api/drivers/${driverId}/teammate-battle?year=2092`);
    const { data } = (await res.json()) as BattleBody;

    expect(data.races.map((r) => r.roundNumber)).toEqual([1, 2, 3]);
    expect(data.races[2]).toEqual({
      raceId: expect.any(Number),
      roundNumber: 3,
      raceName: 'Round 3 Grand Prix',
      qualiGapMs: -100,
      driver: { qualiPosition: 2, finishPosition: 5, status: 'Finished', points: 10 },
      teammate: { qualiPosition: 6, finishPosition: 18, status: 'Retired', points: 0 },
    });
    expect(data.medianQualiGapMs).toBe(-100);
  });
});
