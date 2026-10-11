import { asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../../config/database';
import { drivers, seasons, teams, titleOddsDrivers, titleOddsTeams } from '../../db/schema';
import type { TitleOddsResponse } from '../../common/types';
import { toDriver, toTeam } from '../../common/mappers';

type OddsRow = typeof titleOddsDrivers.$inferSelect | typeof titleOddsTeams.$inferSelect;

function oddsFields(r: OddsRow) {
  return {
    titleProbability: Number(r.titleProbability),
    expectedPoints: Number(r.expectedPoints),
    pointsP10: Number(r.pointsP10),
    pointsP90: Number(r.pointsP90),
  };
}

export class TitleOddsService {
  async findTitleOdds(db: Db, year: number): Promise<TitleOddsResponse | null> {
    const [driverRows, teamRows] = await Promise.all([
      db
        .select({ odds: titleOddsDrivers, driver: drivers, team: teams })
        .from(titleOddsDrivers)
        .innerJoin(seasons, eq(titleOddsDrivers.seasonId, seasons.id))
        .innerJoin(drivers, eq(titleOddsDrivers.driverId, drivers.id))
        .innerJoin(teams, eq(drivers.teamId, teams.id))
        .where(eq(seasons.year, year))
        .orderBy(asc(titleOddsDrivers.afterRound), desc(titleOddsDrivers.titleProbability), desc(titleOddsDrivers.expectedPoints)),
      db
        .select({ odds: titleOddsTeams, team: teams })
        .from(titleOddsTeams)
        .innerJoin(seasons, eq(titleOddsTeams.seasonId, seasons.id))
        .innerJoin(teams, eq(titleOddsTeams.teamId, teams.id))
        .where(eq(seasons.year, year))
        .orderBy(desc(titleOddsTeams.afterRound), desc(titleOddsTeams.titleProbability), desc(titleOddsTeams.expectedPoints)),
    ]);
    if (driverRows.length === 0) return null;

    const afterRound = Math.max(...driverRows.map((r) => r.odds.afterRound));
    return {
      afterRound,
      drivers: driverRows
        .filter((r) => r.odds.afterRound === afterRound)
        .map((r) => ({ driver: toDriver(r.driver, r.team), ...oddsFields(r.odds) })),
      teams: teamRows
        .filter((r) => r.odds.afterRound === afterRound)
        .map((r) => ({ team: toTeam(r.team), ...oddsFields(r.odds) })),
      history: driverRows.map((r) => ({
        afterRound: r.odds.afterRound, driverId: r.driver.id, titleProbability: Number(r.odds.titleProbability),
      })),
    };
  }
}
