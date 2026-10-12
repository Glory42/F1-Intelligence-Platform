import { and, asc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../config/database';
import { circuits, drivers, races, teams } from '../db/schema';
import type { LapSummary, PredictionOf } from './types';
import { toDriver, toRace } from './mappers';
import { mapFeatureRow } from './feature-manifest';
import type { AnySessionKind, SessionKind } from './session-kind';

type RaceRow = typeof races.$inferSelect;
type CircuitRow = typeof circuits.$inferSelect;
type PredictionMeta = { predictedWinnerId: number; computedAt: Date; modelVersion: string };
type FeatureTable = AnySessionKind['features'];

function predictionMeta(kind: AnySessionKind) {
  const t = kind.predictions;
  return { predictedWinnerId: t.predictedWinnerId, computedAt: t.computedAt, modelVersion: t.modelVersion };
}

// The next race whose prediction for this session is out and whose session is still ahead.
export async function findUpcomingPrediction<TF extends FeatureTable, TS>(
  db: Db, kind: SessionKind<TF, TS>,
): Promise<PredictionOf<TS> | null> {
  const [row] = await db
    .select({ prediction: predictionMeta(kind), race: races, circuit: circuits })
    .from(kind.predictions)
    .innerJoin(races, eq(kind.predictions.raceId, races.id))
    .innerJoin(circuits, eq(races.circuitId, circuits.id))
    .where(and(inArray(races.status, [...kind.upcoming]), gte(sql`DATE(${kind.date})`, sql`CURRENT_DATE`)))
    .orderBy(asc(kind.date))
    .limit(1);
  return row ? assemblePrediction(db, kind, row.prediction, row.race, row.circuit) : null;
}

export async function findPrediction<TF extends FeatureTable, TS>(
  db: Db, kind: SessionKind<TF, TS>, race: RaceRow, circuit: CircuitRow,
): Promise<PredictionOf<TS> | null> {
  const [prediction] = await db
    .select(predictionMeta(kind))
    .from(kind.predictions)
    .where(eq(kind.predictions.raceId, race.id))
    .limit(1);
  return prediction ? assemblePrediction(db, kind, prediction, race, circuit) : null;
}

// A Prediction is the winner pointer plus every driver's feature row, ranked by predicted position.
async function assemblePrediction<TF extends FeatureTable, TS>(
  db: Db, kind: SessionKind<TF, TS>, prediction: PredictionMeta, race: RaceRow, circuit: CircuitRow,
): Promise<PredictionOf<TS> | null> {
  // Drizzle can't infer rows from a generic table, so query the union and narrow back to TF's row.
  const table: FeatureTable = kind.features;
  const rows = await db
    .select({ feature: table, driver: drivers, team: teams })
    .from(table)
    .innerJoin(drivers, eq(table.driverId, drivers.id))
    .innerJoin(teams, eq(drivers.teamId, teams.id))
    .where(eq(table.raceId, race.id))
    .orderBy(asc(table.predictedPosition));

  const winner = rows.find((r) => r.driver.id === prediction.predictedWinnerId);
  if (!winner) return null;
  return {
    race: toRace(race, circuit),
    predictedWinner: toDriver(winner.driver, winner.team),
    computedAt: prediction.computedAt.toISOString(),
    modelVersion: prediction.modelVersion,
    drivers: rows.map((r) => ({
      driver: toDriver(r.driver, r.team),
      winProbability: r.feature.winProbability,
      predictedPosition: r.feature.predictedPosition,
      features: mapFeatureRow<TF['$inferSelect'], TS>(r.feature as TF['$inferSelect'], kind.manifest),
    })),
  };
}

// Pit in/out laps and untimed laps would skew a driver's average, so neither counts as a lap here.
export async function findLapSummaries(db: Db, kind: AnySessionKind, raceId: number): Promise<LapSummary[]> {
  const { laps } = kind;
  const fastest = sql<number>`min(${laps.lapTimeMs})::int`;
  const rows = await db
    .select({
      driver: drivers,
      team: teams,
      fastestLapMs: fastest,
      avgLapMs: sql<number>`round(avg(${laps.lapTimeMs}))::int`,
      totalLaps: sql<number>`count(*)::int`,
    })
    .from(laps)
    .innerJoin(drivers, eq(laps.driverId, drivers.id))
    .innerJoin(teams, eq(drivers.teamId, teams.id))
    .where(and(eq(laps.raceId, raceId), isNotNull(laps.lapTimeMs), eq(laps.isPitLap, false)))
    .groupBy(drivers.id, teams.id)
    .orderBy(asc(fastest));

  return rows.map((r) => ({
    driverId: r.driver.id,
    fastestLapMs: r.fastestLapMs,
    avgLapMs: r.avgLapMs,
    totalLaps: r.totalLaps,
    driver: toDriver(r.driver, r.team),
  }));
}
