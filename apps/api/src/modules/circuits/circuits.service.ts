import { eq, and, asc, desc, isNotNull, sql, inArray } from 'drizzle-orm';
import type { Db } from '../../config/database';
import {
  races, circuits, raceResults, qualifyingResults, lapTimes, drivers, teams, qualifyingLapTelemetry, seasons,
} from '../../db/schema';
import type { CircuitDetailResponse, CircuitTelemetry } from '../../common/types';
import { toDriver, toCircuit } from '../../common/mappers';
import { thinTrace, trackProfile } from './track-profile.helpers';
import { aggregateEraWins, buildDominanceByEra } from './circuit-era.helpers';
import { buildOutlinePath } from './track-outline.helpers';
import { backfillDriverHeadshots } from './circuit-headshots.helpers';
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

export class CircuitsService {
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
}
