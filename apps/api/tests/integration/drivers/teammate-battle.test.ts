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

    const weekends = [
      { quali: [3, 4], race: [[2, 'Finished', '18'], [6, 'Finished', '8']] },
      { quali: [5, 4], race: [[1, 'Finished', '25'], [3, 'Finished', '15']] },
      { quali: [2, 6], race: [[5, 'Finished', '10'], [18, 'Retired', '0']] },
    ] as const;
    for (const [i, w] of weekends.entries()) {
      const race = await createRace(db, season.id, circuit.id, { roundNumber: i + 1, status: 'completed' });
      await createQualifyingResult(db, race.id, a.id, { gridPosition: w.quali[0] });
      await createQualifyingResult(db, race.id, b.id, { gridPosition: w.quali[1] });
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
});
