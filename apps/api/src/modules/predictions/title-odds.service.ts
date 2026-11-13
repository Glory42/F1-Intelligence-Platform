import { and, asc, count, desc, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../../config/database';
import { drivers, raceResults, races, seasons, teams, titleOddsDrivers, titleOddsTeams } from '../../db/schema';
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

// finishes[i] = grand prix finishes in position i + 1: the countback that breaks a tie on points.
function finishCounts(rows: Array<{ driverId: number; position: number | null; finishes: number }>): Map<number, number[]> {
  const byDriver = new Map<number, number[]>();
  for (const r of rows) {
    if (r.position == null) continue;
    const counts = byDriver.get(r.driverId) ?? [];
    for (let i = counts.length; i < r.position; i++) counts.push(0);
    counts[r.position - 1] = r.finishes;
    byDriver.set(r.driverId, counts);
  }
  return byDriver;
}

export class TitleOddsService {
  async findTitleOdds(db: Db, year: number): Promise<TitleOddsResponse | null> {
    const [driverRows, teamRows, finishRows] = await Promise.all([
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
      db
        .select({ driverId: raceResults.driverId, position: raceResults.finishPosition, finishes: count() })
        .from(raceResults)
        .innerJoin(races, eq(raceResults.raceId, races.id))
        .innerJoin(seasons, eq(races.seasonId, seasons.id))
        .where(and(eq(seasons.year, year), isNotNull(raceResults.finishPosition)))
        .groupBy(raceResults.driverId, raceResults.finishPosition),
    ]);
    if (driverRows.length === 0) return null;

    const afterRound = Math.max(...driverRows.map((r) => r.odds.afterRound));
    const finishes = finishCounts(finishRows);
    return {
      afterRound,
      drivers: driverRows
        .filter((r) => r.odds.afterRound === afterRound)
        .map((r) => ({ driver: toDriver(r.driver, r.team), ...oddsFields(r.odds), finishes: finishes.get(r.driver.id) ?? [] })),
      teams: teamRows
        .filter((r) => r.odds.afterRound === afterRound)
        .map((r) => ({ team: toTeam(r.team), ...oddsFields(r.odds) })),
      history: driverRows.map((r) => ({
        afterRound: r.odds.afterRound, driverId: r.driver.id, titleProbability: Number(r.odds.titleProbability),
      })),
    };
  }
}
