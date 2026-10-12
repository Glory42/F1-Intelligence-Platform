import { eq, and, asc, gte, lte } from 'drizzle-orm';
import type { Db } from '../../config/database';
import { races, circuits, raceResults, qualifyingResults, drivers, teams, raceStatusEnum } from '../../db/schema';
import type { Race, RaceDetailResponse, RaceResult, QualifyingResult } from '../../common/types';
import { toRace, toRaceResult, toQualifyingResult } from '../../common/mappers';
import { GP } from '../../common/session-kind';
import { findLapSummaries } from '../../common/session-reads';

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

  async findDetail(
    db: Db,
    race: typeof races.$inferSelect,
    circuit: typeof circuits.$inferSelect,
  ): Promise<RaceDetailResponse> {
    const raceId = race.id;
    const [resultsRows, qualifyingRows, laps] = await Promise.all([
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

      findLapSummaries(db, GP, raceId),
    ]);

    const results: RaceResult[] = resultsRows.map(toRaceResult);
    const qualifying: QualifyingResult[] = qualifyingRows.map(toQualifyingResult);

    return { race: toRace(race, circuit), results, qualifying, laps };
  }
}
