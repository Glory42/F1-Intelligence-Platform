import { pgTable, serial, integer, numeric, jsonb, varchar, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { StoredGpFeatures } from '../../common/types';
import { races } from './races';
import { drivers } from './drivers';

// pre-quali-v1: a GP's forecast before qualifying, one row per driver of the lineup from the race before it
// (data-engine compute_pre_quali, ADR 0015). Kept after qualifying so the page can show how chances moved.
export const preQualiPredictions = pgTable('pre_quali_predictions', {
  id: serial('id').primaryKey(),
  raceId: integer('race_id').notNull().references(() => races.id),
  driverId: integer('driver_id').notNull().references(() => drivers.id),

  features: jsonb('features').$type<StoredGpFeatures>().notNull(),
  rawWeightedScore: numeric('raw_weighted_score', { precision: 8, scale: 6 }).notNull(),
  winProbability: numeric('win_probability', { precision: 6, scale: 5 }).notNull(),
  predictedPosition: integer('predicted_position'),
  modelVersion: varchar('model_version', { length: 20 }).notNull(),

  computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('pre_quali_predictions_race_driver_idx').on(t.raceId, t.driverId),
]);
