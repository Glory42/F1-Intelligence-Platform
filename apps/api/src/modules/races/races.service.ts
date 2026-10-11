import { eq, and, asc, gte, lte, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../config/database';
import { races, circuits, raceResults, qualifyingResults, lapTimes, drivers, teams, raceStatusEnum } from '../../db/schema';
import type { Race, RaceDetailResponse, RaceResult, QualifyingResult, LapSummary } from '../../common/types';
import { toDriver, toRace, toRaceResult, toQualifyingResult } from '../../common/mappers';

export class RacesService {
  async findAll(db: Db, year: number, status?: string): Promise<Race[]> {
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const validStatus = status && (raceStatusEnum.enumValues as readonly string[]).includes(status)
      ? (status as (typeof raceStatusEnum.enumValues)[number])
      : undefined;
    const rows = await db
      .select()
      .from(races)
      .innerJoin(circuits, eq(races.circuitId, circuits.id))
      .where(
        validStatus
          ? and(gte(races.raceDate, yearStart), lte(races.raceDate, yearEnd), eq(races.status, validStatus))
          : and(gte(races.raceDate, yearStart), lte(races.raceDate, yearEnd))
      )
      .orderBy(asc(races.raceDate));

    return rows.map((r) => toRace(r.races, r.circuits));
  }

  async findById(db: Db, raceId: number): Promise<RaceDetailResponse | null> {
    const raceRows = await db
      .select()
      .from(races)
      .innerJoin(circuits, eq(races.circuitId, circuits.id))
      .where(eq(races.id, raceId))
      .limit(1);

    if (!raceRows[0]) return null;
    const { races: race, circuits: circuit } = raceRows[0];

    const [resultsRows, qualifyingRows, lapRows] = await Promise.all([
      db
        .select()
        .from(raceResults)
        .innerJoin(drivers, eq(raceResults.driverId, drivers.id))
        .innerJoin(teams, eq(drivers.teamId, teams.id))
        .where(eq(raceResults.raceId, raceId))
        .orderBy(asc(raceResults.finishPosition)),

      db
        .select()
        .from(qualifyingResults)
        .innerJoin(drivers, eq(qualifyingResults.driverId, drivers.id))
        .innerJoin(teams, eq(drivers.teamId, teams.id))
        .where(eq(qualifyingResults.raceId, raceId))
        .orderBy(asc(qualifyingResults.gridPosition)),

      db
        .select({
          driverId: lapTimes.driverId,
          fastestLapMs: sql<number>`min(${lapTimes.lapTimeMs})`,
          avgLapMs: sql<number>`round(avg(${lapTimes.lapTimeMs}))`,
          totalLaps: sql<number>`count(*)`,
        })
        .from(lapTimes)
        .where(and(eq(lapTimes.raceId, raceId), isNotNull(lapTimes.lapTimeMs), eq(lapTimes.isPitLap, false)))
        .groupBy(lapTimes.driverId),
    ]);

    const driverMap = new Map(resultsRows.map((r) => [r.drivers.id, toDriver(r.drivers, r.teams)]));

    const results: RaceResult[] = resultsRows.map(toRaceResult);
    const qualifying: QualifyingResult[] = qualifyingRows.map(toQualifyingResult);

    const laps: LapSummary[] = lapRows
      .map((r) => ({
        driverId: r.driverId,
        fastestLapMs: r.fastestLapMs,
        avgLapMs: r.avgLapMs,
        totalLaps: Number(r.totalLaps),
        driver: driverMap.get(r.driverId)!,
      }))
      .filter((l) => l.driver);

    return { race: toRace(race, circuit), results, qualifying, laps };
  }
}
