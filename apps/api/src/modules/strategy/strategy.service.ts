import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../config/database';
import {
  drivers, lapTimes, racePitStops, raceResults, raceStints, sprintLapTimes, sprintResults, teams,
} from '../../db/schema';
import type { RaceSession, StrategyResponse, TyreStint } from '../../common/types';
import { toDriver } from '../../common/mappers';

export class StrategyService {
  async findStrategy(db: Db, raceId: number, session: RaceSession): Promise<StrategyResponse> {
    const results = session === 'sprint' ? sprintResults : raceResults;
    const [entrantRows, stintRows, pitRows] = await Promise.all([
      db
        .select({ driver: drivers, team: teams, finishPosition: results.finishPosition })
        .from(results)
        .innerJoin(drivers, eq(results.driverId, drivers.id))
        .innerJoin(teams, eq(drivers.teamId, teams.id))
        .where(eq(results.raceId, raceId))
        .orderBy(asc(results.finishPosition)),
      db
        .select()
        .from(raceStints)
        .where(and(eq(raceStints.raceId, raceId), eq(raceStints.sessionType, session)))
        .orderBy(asc(raceStints.stintNumber)),
      db
        .select()
        .from(racePitStops)
        .where(and(eq(racePitStops.raceId, raceId), eq(racePitStops.sessionType, session)))
        .orderBy(asc(racePitStops.lapNumber)),
    ]);

    const openf1Stints = stintRows.map((s) => ({
      driverId: s.driverId,
      stint: {
        stintNumber: s.stintNumber, compound: s.compound, lapStart: s.lapStart,
        lapEnd: s.lapEnd, tyreAgeAtStart: s.tyreAgeAtStart,
      },
    }));
    const stints = openf1Stints.length > 0 ? openf1Stints : await this.deriveStints(db, raceId, session);
    const source = openf1Stints.length > 0 ? 'openf1' : stints.length > 0 ? 'derived' : 'none';

    return {
      source,
      drivers: entrantRows.map((r) => ({
        driver: toDriver(r.driver, r.team),
        finishPosition: r.finishPosition,
        stints: stints.filter((s) => s.driverId === r.driver.id).map((s) => s.stint),
        pitStops: pitRows
          .filter((p) => p.driverId === r.driver.id)
          .map((p) => ({ lapNumber: p.lapNumber, pitLaneMs: p.pitLaneMs, stationaryMs: p.stationaryMs })),
      })),
    };
  }

  // Pre-2023 races have no OpenF1 stints. lap_times only keeps accurate laps (no in/out laps),
  // so each stint spans its first..last stored lap and the set's age is unknown.
  private async deriveStints(
    db: Db, raceId: number, session: RaceSession,
  ): Promise<Array<{ driverId: number; stint: TyreStint }>> {
    const laps = session === 'sprint' ? sprintLapTimes : lapTimes;
    const rows = await db
      .select({
        driverId: laps.driverId,
        stintNumber: laps.stintNumber,
        compound: sql<string | null>`min(${laps.compound})`,
        lapStart: sql<number>`min(${laps.lapNumber})`,
        lapEnd: sql<number>`max(${laps.lapNumber})`,
      })
      .from(laps)
      .where(and(eq(laps.raceId, raceId), isNotNull(laps.stintNumber)))
      .groupBy(laps.driverId, laps.stintNumber)
      .orderBy(asc(laps.stintNumber));

    return rows.map((r) => ({
      driverId: r.driverId,
      stint: {
        stintNumber: r.stintNumber!, compound: r.compound,
        lapStart: Number(r.lapStart), lapEnd: Number(r.lapEnd), tyreAgeAtStart: null,
      },
    }));
  }
}
