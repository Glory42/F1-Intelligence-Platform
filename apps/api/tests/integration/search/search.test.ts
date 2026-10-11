import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { createSeason } from '../../support/factories/season.factory';
import { createCircuit } from '../../support/factories/circuit.factory';
import { createTeam } from '../../support/factories/team.factory';
import { createDriver } from '../../support/factories/driver.factory';

describe('search (integration)', () => {
  const db = getTestDb();

  beforeAll(async () => {
    await truncateAll(db);

    const season2094 = await createSeason(db, { year: 2094 });
    const season2093 = await createSeason(db, { year: 2093 });

    await createCircuit(db, { circuitKey: 'search-test-circuit', name: 'Search Test Circuit' });

    // Same team key across two seasons: search should return only the most recent one.
    const teamOld = await createTeam(db, season2093.id, { teamKey: 'search-test-team', name: 'Search Test Team (old name)' });
    const teamNew = await createTeam(db, season2094.id, { teamKey: 'search-test-team', name: 'Search Test Team' });
    await createDriver(db, season2093.id, teamOld.id, { driverNumber: 1, code: 'OLD', firstName: 'Old', lastName: 'Driver' });
    await createDriver(db, season2094.id, teamNew.id, { driverNumber: 1, code: 'NEW', firstName: 'New', lastName: 'Driver' });
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it('returns drivers, teams, and circuits, deduplicated to the most recent season', async () => {
    const res = await apiRequest('/api/search');
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { drivers: Array<{ code: string }>; teams: Array<{ name: string }>; circuits: Array<{ name: string }> };
    };

    const searchTeams = data.teams.filter((t) => t.name.startsWith('Search Test Team'));
    expect(searchTeams).toHaveLength(1);
    expect(searchTeams[0].name).toBe('Search Test Team');

    expect(data.circuits.some((c) => c.name === 'Search Test Circuit')).toBe(true);
    expect(data.drivers.some((d) => d.code === 'NEW')).toBe(true);
  });
});
