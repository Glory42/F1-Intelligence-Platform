import type { Db } from '../../../src/config/database';
import { titleOddsDrivers, titleOddsTeams } from '../../../src/db/schema';

type DriverOddsInsert = typeof titleOddsDrivers.$inferInsert;
type TeamOddsInsert = typeof titleOddsTeams.$inferInsert;

const ODDS_DEFAULTS = {
  expectedPoints: '300.0', pointsP10: '280.0', pointsP90: '320.0', simulations: 10000, modelVersion: 'title-odds-v1',
};

export async function createDriverTitleOdds(
  db: Db, seasonId: number, driverId: number, overrides: Partial<DriverOddsInsert> = {}
) {
  const [row] = await db
    .insert(titleOddsDrivers)
    .values({ seasonId, driverId, afterRound: 1, titleProbability: '0.50000', ...ODDS_DEFAULTS, ...overrides })
    .returning();
  return row;
}

export async function createTeamTitleOdds(
  db: Db, seasonId: number, teamId: number, overrides: Partial<TeamOddsInsert> = {}
) {
  const [row] = await db
    .insert(titleOddsTeams)
    .values({ seasonId, teamId, afterRound: 1, titleProbability: '0.50000', ...ODDS_DEFAULTS, ...overrides })
    .returning();
  return row;
}
