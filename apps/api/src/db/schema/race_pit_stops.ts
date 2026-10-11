import { pgTable, serial, integer, varchar, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { races } from './races';
import { drivers } from './drivers';

// OpenF1 /pit (2023+). stationary_ms only exists from the 2024 US GP onward.
export const racePitStops = pgTable('race_pit_stops', {
  id: serial('id').primaryKey(),
  raceId: integer('race_id').notNull().references(() => races.id),
  sessionType: varchar('session_type', { length: 10 }).notNull().default('race'),
  driverId: integer('driver_id').notNull().references(() => drivers.id),
  lapNumber: integer('lap_number').notNull(),
  pitLaneMs: integer('pit_lane_ms'),
  stationaryMs: integer('stationary_ms'),
  date: timestamp('date', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('race_pit_stops_race_session_driver_lap_idx').on(t.raceId, t.sessionType, t.driverId, t.lapNumber),
  index('race_pit_stops_driver_idx').on(t.driverId),
]);
