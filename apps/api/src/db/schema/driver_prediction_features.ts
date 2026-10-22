import { pgTable, serial, integer, numeric, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { StoredGpFeatures } from '../../common/types';
import { races } from './races';
import { drivers } from './drivers';

// weighted-v4: one row per driver per GP. The fitted model's features live in one JSONB object
// (feature → value + contribution) so a refit with different features needs no migration.
export const driverPredictionFeatures = pgTable('driver_prediction_features', {
  id: serial('id').primaryKey(),
  raceId: integer('race_id').notNull().references(() => races.id),
  driverId: integer('driver_id').notNull().references(() => drivers.id),

  features: jsonb('features').$type<StoredGpFeatures>().notNull(),
  // Sum of the contributions: the driver's log-odds score (softmax over the field gives winProbability).
  rawWeightedScore: numeric('raw_weighted_score', { precision: 8, scale: 6 }).notNull(),
  winProbability: numeric('win_probability', { precision: 6, scale: 5 }).notNull(),
  predictedPosition: integer('predicted_position'),

  computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('driver_prediction_features_race_driver_idx').on(t.raceId, t.driverId),
]);
