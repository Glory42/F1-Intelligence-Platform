import { pgTable, serial, integer, varchar, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { LapTelemetrySamples } from '../../common/types';
import { races } from './races';
import { drivers } from './drivers';

// Each driver's fastest Q / SQ lap from OpenF1 (2023+), resampled every 10 m into int arrays.
// One JSONB row per driver (~10 KB after TOAST): always read whole, never queried per sample.
export const qualifyingLapTelemetry = pgTable('qualifying_lap_telemetry', {
  id: serial('id').primaryKey(),
  raceId: integer('race_id').notNull().references(() => races.id),
  sessionType: varchar('session_type', { length: 4 }).notNull(),
  driverId: integer('driver_id').notNull().references(() => drivers.id),
  lapNumber: integer('lap_number').notNull(),
  lapTimeMs: integer('lap_time_ms').notNull(),
  samples: jsonb('samples').$type<LapTelemetrySamples>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('qualifying_lap_telemetry_race_session_driver_idx').on(t.raceId, t.sessionType, t.driverId),
]);
