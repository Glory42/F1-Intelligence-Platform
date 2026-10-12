import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { createSeason } from '../../support/factories/season.factory';
import { createTeam } from '../../support/factories/team.factory';
import { createDriver } from '../../support/factories/driver.factory';
import { createDriverSeasonStats } from '../../support/factories/driverSeasonStats.factory';
import { createCircuit } from '../../support/factories/circuit.factory';
import { createRace } from '../../support/factories/race.factory';
import { createRaceResult } from '../../support/factories/raceResult.factory';

describe('drivers (integration)', () => {
  const db = getTestDb();
  let driverAId: number;

  beforeAll(async () => {
    await truncateAll(db);

    const season = await createSeason(db, { year: 2098 });
    const teamA = await createTeam(db, season.id, { teamKey: 'team-a', name: 'Team Alpha' });
    const teamB = await createTeam(db, season.id, { teamKey: 'team-b', name: 'Team Beta' });
    const driverA = await createDriver(db, season.id, teamA.id, { driverNumber: 1, code: 'AAA', firstName: 'Ada', lastName: 'Alpha' });
    const driverB = await createDriver(db, season.id, teamB.id, { driverNumber: 2, code: 'BBB', firstName: 'Bo', lastName: 'Beta' });

    await createDriverSeasonStats(db, season.id, driverA.id, { wins: 5, totalPoints: '300.0', sprintTotalPoints: '24.0', championshipPosition: 1 });
    await createDriverSeasonStats(db, season.id, driverB.id, { wins: 1, totalPoints: '120.0', championshipPosition: 2 });

    const circuit = await createCircuit(db, { circuitKey: 'drivers-test-circuit' });
    const race = await createRace(db, season.id, circuit.id, { raceDate: '2098-02-01', name: 'Drivers Test GP' });
    await createRaceResult(db, race.id, driverA.id, { finishPosition: 1 });

    driverAId = driverA.id;
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it('lists drivers for a year with their team joined', async () => {
    const res = await apiRequest('/api/drivers?year=2098');
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Array<{ code: string; team: { name: string } }> };
    expect(data).toHaveLength(2);
    const driver = data.find((d) => d.code === 'AAA');
    expect(driver?.team.name).toBe('Team Alpha');
  });

  it('filters by team_id', async () => {
    const listRes = await apiRequest('/api/drivers?year=2098');
    const { data: all } = (await listRes.json()) as { data: Array<{ code: string; teamId: number }> };
    const teamAId = all.find((d) => d.code === 'AAA')!.teamId;

    const filtered = await apiRequest(`/api/drivers?year=2098&team_id=${teamAId}`);
    const { data } = (await filtered.json()) as { data: Array<{ code: string }> };
    expect(data).toHaveLength(1);
    expect(data[0].code).toBe('AAA');
  });

  it('ranks standings by championship position', async () => {
    const res = await apiRequest('/api/drivers/standings?year=2098');
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Array<{ driver: { code: string } }> };
    expect(data[0].driver.code).toBe('AAA');
    expect(data[1].driver.code).toBe('BBB');
  });

  it('reports sprint points alongside grand prix points', async () => {
    const res = await apiRequest('/api/drivers/standings?year=2098');
    const { data } = (await res.json()) as { data: Array<{ stats: { totalPoints: string; sprintTotalPoints: string } }> };
    expect([data[0].stats.totalPoints, data[0].stats.sprintTotalPoints]).toEqual(['300.0', '24.0']);
  });

  it('totals grand prix and sprint points into championship points', async () => {
    const res = await apiRequest('/api/drivers/standings?year=2098');
    const { data } = (await res.json()) as { data: Array<{ stats: { championshipPoints: string } }> };
    expect(data.map((d) => d.stats.championshipPoints)).toEqual(['324.0', '120.0']);
  });

  it('returns driver detail with season stats and recent results', async () => {
    const res = await apiRequest(`/api/drivers/${driverAId}?year=2098`);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { driver: { code: string }; seasonStats: { wins: number; championshipPoints: string }; recentResults: unknown[] };
    };
    expect(data.driver.code).toBe('AAA');
    expect(data.seasonStats.wins).toBe(5);
    expect(data.seasonStats.championshipPoints).toBe('324.0');
    expect(data.recentResults).toHaveLength(1);
  });

  it('returns 404 for a driver that does not exist', async () => {
    const res = await apiRequest('/api/drivers/999999999?year=2098');
    expect(res.status).toBe(404);
  });
});
