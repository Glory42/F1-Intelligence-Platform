import { pgTable, serial, integer, varchar, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { races } from './races';
import { drivers } from './drivers';

// OpenF1 /stints (2023+): one row per tyre stint, so a whole race's strategy is ~60 rows.
export const raceStints = pgTable('race_stints', {
  id: serial('id').primaryKey(),
  raceId: integer('race_id').notNull().references(() => races.id),
  sessionType: varchar('session_type', { length: 10 }).notNull().default('race'),
  driverId: integer('driver_id').notNull().references(() => drivers.id),
  stintNumber: integer('stint_number').notNull(),
  compound: varchar('compound', { length: 20 }),
  lapStart: integer('lap_start'),
  lapEnd: integer('lap_end'),
  tyreAgeAtStart: integer('tyre_age_at_start'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('race_stints_race_session_driver_stint_idx').on(t.raceId, t.sessionType, t.driverId, t.stintNumber),
]);
