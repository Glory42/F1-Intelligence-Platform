import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { createSeason } from '../../support/factories/season.factory';
import { createTeam } from '../../support/factories/team.factory';
import { createTeamSeasonStats } from '../../support/factories/teamSeasonStats.factory';

interface CareerBody {
  data: Array<{ year: number; teamId: number; stats: { wins: number } | null }>;
}

describe('team career (integration)', () => {
  const db = getTestDb();
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    await truncateAll(db);
    const [y2019, y2020, y2024] = [
      await createSeason(db, { year: 2019 }), await createSeason(db, { year: 2020 }), await createSeason(db, { year: 2024 }),
    ];
    // Faenza: Toro Rosso, then AlphaTauri, then RB. Its sister team Red Bull runs alongside.
    ids.toroRosso = (await createTeam(db, y2019.id, { teamKey: 'toro_rosso', name: 'Toro Rosso' })).id;
    ids.alphaTauri = (await createTeam(db, y2020.id, { teamKey: 'alphatauri', name: 'AlphaTauri' })).id;
    ids.rb = (await createTeam(db, y2024.id, { teamKey: 'rb', name: 'RB' })).id;
    ids.redBull = (await createTeam(db, y2020.id, { teamKey: 'red_bull_racing', name: 'Red Bull Racing' })).id;
    await createTeamSeasonStats(db, y2020.id, ids.alphaTauri, { wins: 1 });
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it('follows one outfit through its rebrands, newest season first', async () => {
    const res = await apiRequest(`/api/teams/${ids.rb}/career`);
    const { data } = (await res.json()) as CareerBody;

    expect(data.map((d) => [d.year, d.teamId, d.stats?.wins ?? null])).toEqual([
      [2024, ids.rb, null],
      [2020, ids.alphaTauri, 1],
      [2019, ids.toroRosso, null],
    ]);
  });

  it('keeps the sister team out of the career', async () => {
    const res = await apiRequest(`/api/teams/${ids.redBull}/career`);
    const { data } = (await res.json()) as CareerBody;

    expect(data.map((d) => d.teamId)).toEqual([ids.redBull]);
  });
});
