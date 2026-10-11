import { eq, asc, and, gte, sql } from 'drizzle-orm';
import type { Db } from '../../config/database';
import {
  races, circuits, racePredictions, driverPredictionFeatures, drivers, teams,
} from '../../db/schema';
import type { PredictionResponse, FeatureScores } from '../../common/types';
import { buildPredictionResponse } from '../../common/prediction-response';
import { GP_FEATURE_MANIFEST, mapFeatureRow } from '../../common/feature-manifest';

export function toFeatures(f: typeof driverPredictionFeatures.$inferSelect): FeatureScores {
  return mapFeatureRow(f, GP_FEATURE_MANIFEST);
}

export function buildGpPredictionResponse(
  db: Db,
  target: 'upcoming' | number,
): Promise<PredictionResponse | null> {
  return buildPredictionResponse<typeof driverPredictionFeatures.$inferSelect, FeatureScores>(db, {
    target,
    queryUpcoming: (db) =>
      db
        .select()
        .from(racePredictions)
        .innerJoin(races, eq(racePredictions.raceId, races.id))
        .innerJoin(circuits, eq(races.circuitId, circuits.id))
        .where(and(
          eq(races.status, 'qualifying_done'),
          gte(races.raceDate, sql`CURRENT_DATE`),
        ))
        .orderBy(asc(races.raceDate))
        .limit(1)
        .then((rows) => rows.map((r) => ({ prediction: r.race_predictions, race: r.races, circuit: r.circuits }))),
    queryById: (db, raceId) =>
      db
        .select()
        .from(racePredictions)
        .innerJoin(races, eq(racePredictions.raceId, races.id))
        .innerJoin(circuits, eq(races.circuitId, circuits.id))
        .where(eq(racePredictions.raceId, raceId))
        .limit(1)
        .then((rows) => rows.map((r) => ({ prediction: r.race_predictions, race: r.races, circuit: r.circuits }))),
    fetchFeatureRows: (db, raceId) =>
      db
        .select()
        .from(driverPredictionFeatures)
        .innerJoin(drivers, eq(driverPredictionFeatures.driverId, drivers.id))
        .innerJoin(teams, eq(drivers.teamId, teams.id))
        .where(eq(driverPredictionFeatures.raceId, raceId))
        .orderBy(asc(driverPredictionFeatures.predictedPosition))
        .then((rows) => rows.map((r) => ({
          driverId: r.drivers.id,
          driver: r.drivers,
          team: r.teams,
          winProbability: r.driver_prediction_features.winProbability,
          predictedPosition: r.driver_prediction_features.predictedPosition,
          raw: r.driver_prediction_features,
        }))),
    toFeatures,
  });
}
