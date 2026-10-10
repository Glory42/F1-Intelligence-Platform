import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../config/database';
import { drivers, raceOvertakes, races, seasons, teams } from '../../db/schema';
import type { RacecraftRow } from '../../common/types';
import { toDriver } from '../../common/mappers';

export class RacecraftService {
  // GP-session passes only (sprints are short and grid-dominated). OpenF1 overtakes are 2023+.
  async findRacecraft(db: Db, year: number): Promise<RacecraftRow[]> {
    const inSeasonGp = and(eq(seasons.year, year), eq(raceOvertakes.sessionType, 'race'));
    const countBy = (column: typeof raceOvertakes.overtakingDriverId | typeof raceOvertakes.overtakenDriverId) =>
      db
        .select({ driverId: column, count: sql<number>`count(*)` })
        .from(raceOvertakes)
        .innerJoin(races, eq(raceOvertakes.raceId, races.id))
        .innerJoin(seasons, eq(races.seasonId, seasons.id))
        .where(inSeasonGp)
        .groupBy(column);

    const [madeRows, sufferedRows] = await Promise.all([
      countBy(raceOvertakes.overtakingDriverId),
      countBy(raceOvertakes.overtakenDriverId),
    ]);
    const made = new Map(madeRows.map((r) => [r.driverId, Number(r.count)]));
    const suffered = new Map(sufferedRows.map((r) => [r.driverId, Number(r.count)]));
    const ids = [...new Set([...made.keys(), ...suffered.keys()])];
    if (ids.length === 0) return [];

    const driverRows = await db
      .select({ driver: drivers, team: teams })
      .from(drivers)
      .innerJoin(teams, eq(drivers.teamId, teams.id))
      .where(inArray(drivers.id, ids));

    return driverRows
      .map((r) => {
        const m = made.get(r.driver.id) ?? 0;
        const s = suffered.get(r.driver.id) ?? 0;
        return { driver: toDriver(r.driver, r.team), made: m, suffered: s, net: m - s };
      })
      .sort((a, b) => b.net - a.net || b.made - a.made);
  }
}
