import { eq, and, asc, desc, gte, lte, isNotNull, sql, inArray } from 'drizzle-orm';
import type { Db } from '../../config/database';
import {
  races, circuits, raceResults, qualifyingResults, lapTimes, drivers, teams, raceStatusEnum, qualifyingLapTelemetry, seasons,
} from '../../db/schema';
import type { Race, RaceDetailResponse, RaceResult, QualifyingResult, LapSummary, CircuitDetailResponse, CircuitTelemetry } from '../../common/types';
import { thinTrace, trackProfile } from '../../common/trackProfile';
import { toDriver, toRace, toCircuit, toRaceResult, toQualifyingResult } from '../../common/mappers';
import { aggregateEraWins, buildDominanceByEra } from './circuit-era.helpers';
import { buildOutlinePath } from '../../common/trackOutline';
import { backfillDriverHeadshots } from './circuit-headshot-backfill';
import {
  buildCircuitHistory,
  computeQualifyingImpactStats,
  computeSafetyCarStats,
  computeWeatherStats,
  pickFastestLap,
  type FastestLapRow,
  type WinnerRow,
} from './circuit-stats.helpers';

const OUTLINE_SIZE = 1000;
const TRACE_EVERY_M = 50;

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

  async findAllCircuits(db: Db) {
    const rows = await db
      .select()
      .from(circuits)
      .orderBy(asc(circuits.name));
    return rows.map((r) => toCircuit(r));
  }

  async findCircuitDetails(db: Db, circuitKey: string, limit = 10): Promise<CircuitDetailResponse | null> {
    const circuitRows = await db
      .select()
      .from(circuits)
      .where(eq(circuits.circuitKey, circuitKey))
      .limit(1);

    if (!circuitRows.length) return null;
    const circuit = circuitRows[0];

    const raceRows = await db
      .select()
      .from(races)
      .where(and(eq(races.circuitId, circuit.id), eq(races.status, 'completed')))
      .orderBy(desc(races.raceDate));

    const raceIds = raceRows.map((r) => r.id);
    const outlinePath = await this.findOutlinePath(db, circuit.id);

    let winnerRows: WinnerRow[] = [];
    let lapRows: FastestLapRow[] = [];
    if (raceIds.length > 0) {
      [winnerRows, lapRows] = await Promise.all([
        db
          .select()
          .from(raceResults)
          .innerJoin(drivers, eq(raceResults.driverId, drivers.id))
          .innerJoin(teams, eq(drivers.teamId, teams.id))
          .where(and(inArray(raceResults.raceId, raceIds), eq(raceResults.finishPosition, 1))),
        db
          .select()
          .from(lapTimes)
          .innerJoin(drivers, eq(lapTimes.driverId, drivers.id))
          .innerJoin(teams, eq(drivers.teamId, teams.id))
          .innerJoin(races, eq(lapTimes.raceId, races.id))
          .where(and(inArray(lapTimes.raceId, raceIds), isNotNull(lapTimes.lapTimeMs), eq(lapTimes.isPitLap, false)))
          .orderBy(asc(lapTimes.lapTimeMs))
          .limit(1),
      ]);
    }

    const winnerMap = new Map(winnerRows.map((w) => [w.race_results.raceId, w]));
    const raceMap = new Map(raceRows.map((r) => [r.id, r]));
    const raceOrder = new Map(raceIds.map((id, idx) => [id, idx]));

    const { teamWinsByEra, driverWinsByEra } = aggregateEraWins(winnerRows, raceMap, raceOrder);
    await backfillDriverHeadshots(db, driverWinsByEra);

    const history = buildCircuitHistory(raceRows, winnerMap, driverWinsByEra.all, limit);
    const dominance = buildDominanceByEra(teamWinsByEra, driverWinsByEra);
    const qualifyingImpact = computeQualifyingImpactStats(winnerRows);
    const weatherStats = computeWeatherStats(raceRows);
    const safetyCarStats = computeSafetyCarStats(raceRows);
    const fastestLap = pickFastestLap(lapRows);

    return {
      circuit: toCircuit(circuit),
      history,
      fastestLap,
      dominance,
      weatherStats,
      qualifyingImpact,
      safetyCarStats,
      outlinePath,
    };
  }

  // Only the x/y arrays leave Neon, not the whole telemetry row (egress budget).
  private async findOutlinePath(db: Db, circuitId: number): Promise<string | null> {
    const [lap] = await db
      .select({
        x: sql<number[]>`${qualifyingLapTelemetry.samples}->'x'`,
        y: sql<number[]>`${qualifyingLapTelemetry.samples}->'y'`,
      })
      .from(qualifyingLapTelemetry)
      .innerJoin(races, eq(qualifyingLapTelemetry.raceId, races.id))
      .where(eq(races.circuitId, circuitId))
      .orderBy(desc(races.raceDate), asc(qualifyingLapTelemetry.lapTimeMs))
      .limit(1);
    return lap ? buildOutlinePath(lap.x, lap.y, OUTLINE_SIZE) : null;
  }

  // The latest race's pole lap; when that driver's telemetry is missing, its fastest stored Q lap.
  async findCircuitTelemetry(db: Db, circuitKey: string): Promise<CircuitTelemetry | null> {
    const isPole = sql<boolean>`coalesce(${qualifyingResults.gridPosition} = 1, false)`;
    const [lap] = await db
      .select({ lap: qualifyingLapTelemetry, race: races, year: seasons.year, driver: drivers, team: teams, isPole })
      .from(qualifyingLapTelemetry)
      .innerJoin(races, eq(qualifyingLapTelemetry.raceId, races.id))
      .innerJoin(seasons, eq(races.seasonId, seasons.id))
      .innerJoin(circuits, eq(races.circuitId, circuits.id))
      .innerJoin(drivers, eq(qualifyingLapTelemetry.driverId, drivers.id))
      .innerJoin(teams, eq(drivers.teamId, teams.id))
      .leftJoin(qualifyingResults, and(
        eq(qualifyingResults.raceId, qualifyingLapTelemetry.raceId),
        eq(qualifyingResults.driverId, qualifyingLapTelemetry.driverId),
      ))
      .where(and(eq(circuits.circuitKey, circuitKey), eq(qualifyingLapTelemetry.sessionType, 'Q')))
      .orderBy(desc(races.raceDate), desc(isPole), asc(qualifyingLapTelemetry.lapTimeMs))
      .limit(1);
    if (!lap) return null;
    return {
      raceId: lap.race.id,
      year: lap.year,
      raceName: lap.race.name,
      driver: toDriver(lap.driver, lap.team),
      lapTimeMs: lap.lap.lapTimeMs,
      isPoleLap: Boolean(lap.isPole),
      profile: trackProfile(lap.lap.samples),
      trace: thinTrace(lap.lap.samples, TRACE_EVERY_M),
    };
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
