import { pgTable, serial, integer, numeric, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { StoredGpFeatures } from '../../common/types';
import { races } from './races';
import { drivers } from './drivers';

// sprint-v3: weighted-v4's features and weights on the sprint grid, stored the GP's way (feature → value +
// contribution). The *_score columns are sprint-v2's and are dropped once nothing reads them.
export const driverSprintFeatures = pgTable('driver_sprint_features', {
  id: serial('id').primaryKey(),
  raceId: integer('race_id').notNull().references(() => races.id),
  driverId: integer('driver_id').notNull().references(() => drivers.id),

  features: jsonb('features').$type<StoredGpFeatures>(),

  carPerformanceScore: numeric('car_performance_score', { precision: 6, scale: 5 }),
  startingPositionScore: numeric('starting_position_score', { precision: 6, scale: 5 }),
  driverRatingScore: numeric('driver_rating_score', { precision: 6, scale: 5 }),
  trackOvertakeScore: numeric('track_overtake_score', { precision: 6, scale: 5 }),
  shortRunPaceScore: numeric('short_run_pace_score', { precision: 6, scale: 5 }),
  circuitAdjStartPosScore: numeric('circuit_adj_start_pos_score', { precision: 6, scale: 5 }),
  sqQualifyingDeltaScore: numeric('sq_qualifying_delta_score', { precision: 6, scale: 5 }),
  weatherImpactScore: numeric('weather_impact_score', { precision: 6, scale: 5 }),
  winRateScore: numeric('win_rate_score', { precision: 6, scale: 5 }),
  luckFactorScore: numeric('luck_factor_score', { precision: 6, scale: 5 }),

  rawWeightedScore: numeric('raw_weighted_score', { precision: 8, scale: 6 }).notNull(),
  winProbability: numeric('win_probability', { precision: 6, scale: 5 }).notNull().default('0'),
  predictedPosition: integer('predicted_position'),

  computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('driver_sprint_features_race_driver_idx').on(t.raceId, t.driverId),
]);
