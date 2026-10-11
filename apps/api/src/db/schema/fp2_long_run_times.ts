import { pgTable, serial, integer, varchar, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { races } from './races';
import { drivers } from './drivers';

export const fp2LongRunTimes = pgTable('fp2_long_run_times', {
  id: serial('id').primaryKey(),
  raceId: integer('race_id').notNull().references(() => races.id),
  driverId: integer('driver_id').notNull().references(() => drivers.id),
  compound: varchar('compound', { length: 20 }).notNull(),
  // Practice session this long-run data came from: 'FP2' (primary) or 'FP1'
  // (sprint-weekend fallback: those weekends have no FP2 session).
  sessionType: varchar('session_type', { length: 4 }).notNull().default('FP2'),
  medianLapMs: integer('median_lap_ms'),
  stintLength: integer('stint_length'),
  fp2BestLapMs: integer('fp2_best_lap_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('fp2_long_run_times_race_driver_compound_idx').on(t.raceId, t.driverId, t.compound),
]);
