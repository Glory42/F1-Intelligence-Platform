import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { createSeason } from '../../support/factories/season.factory';
import { createTeam } from '../../support/factories/team.factory';
import { createDriver } from '../../support/factories/driver.factory';
import { createTeamSeasonStats } from '../../support/factories/teamSeasonStats.factory';

describe('teams (integration)', () => {
  const db = getTestDb();
  let teamAId: number;

  beforeAll(async () => {
    await truncateAll(db);

    const season = await createSeason(db, { year: 2097 });
    const teamA = await createTeam(db, season.id, { teamKey: 'teams-test-a', name: 'Teams Test Alpha' });
    const teamB = await createTeam(db, season.id, { teamKey: 'teams-test-b', name: 'Teams Test Beta' });
    await createDriver(db, season.id, teamA.id, { driverNumber: 1, code: 'AAA' });
    await createDriver(db, season.id, teamA.id, { driverNumber: 2, code: 'BBB' });

    await createTeamSeasonStats(db, season.id, teamA.id, { wins: 8, totalPoints: '500.0', sprintTotalPoints: '40.0', championshipPosition: 1 });
    // Half points (a shortened race) must still add up exactly.
    await createTeamSeasonStats(db, season.id, teamB.id, { wins: 1, totalPoints: '90.5', sprintTotalPoints: '0.5', championshipPosition: 2 });

    teamAId = teamA.id;
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it('lists teams for a year', async () => {
    const res = await apiRequest('/api/teams?year=2097');
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Array<{ name: string }> };
    expect(data).toHaveLength(2);
  });

  it('ranks standings by championship position', async () => {
    const res = await apiRequest('/api/teams/standings?year=2097');
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Array<{ team: { name: string } }> };
    expect(data[0].team.name).toBe('Teams Test Alpha');
  });

  it('reports sprint points alongside grand prix points', async () => {
    const res = await apiRequest('/api/teams/standings?year=2097');
    const { data } = (await res.json()) as { data: Array<{ stats: { totalPoints: string; sprintTotalPoints: string } }> };
    expect([data[0].stats.totalPoints, data[0].stats.sprintTotalPoints]).toEqual(['500.0', '40.0']);
  });

  it('totals grand prix and sprint points into championship points', async () => {
    const res = await apiRequest('/api/teams/standings?year=2097');
    const { data } = (await res.json()) as { data: Array<{ stats: { championshipPoints: string } }> };
    expect(data.map((t) => t.stats.championshipPoints)).toEqual(['540.0', '91.0']);
  });

  it('returns team detail with season stats and its drivers', async () => {
    const res = await apiRequest(`/api/teams/${teamAId}?year=2097`);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { team: { name: string }; seasonStats: { wins: number; championshipPoints: string }; drivers: unknown[] };
    };
    expect(data.team.name).toBe('Teams Test Alpha');
    expect(data.seasonStats.wins).toBe(8);
    expect(data.seasonStats.championshipPoints).toBe('540.0');
    expect(data.drivers).toHaveLength(2);
  });

  it('returns 404 for a team that does not exist', async () => {
    const res = await apiRequest('/api/teams/999999999?year=2097');
    expect(res.status).toBe(404);
  });
});
