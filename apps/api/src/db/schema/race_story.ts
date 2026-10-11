import { pgTable, serial, integer, varchar, boolean, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { races } from './races';
import { drivers } from './drivers';

// One row per driver per session with per-lap arrays (index 0 = lap 1), not one row per lap:
// always read as a whole race, and ~20 rows/race instead of ~1,200 keeps Neon Free storage tiny.
export const raceLapTraces = pgTable('race_lap_traces', {
  id: serial('id').primaryKey(),
  raceId: integer('race_id').notNull().references(() => races.id),
  sessionType: varchar('session_type', { length: 10 }).notNull().default('race'),
  driverId: integer('driver_id').notNull().references(() => drivers.id),
  positions: integer('positions').array().notNull(),
  // null where the car was lapped (see laps_down) or the leader's lap time is missing.
  gapsMs: integer('gaps_ms').array().$type<Array<number | null>>().notNull(),
  intervalsMs: integer('intervals_ms').array().$type<Array<number | null>>().notNull(),
  lapsDown: integer('laps_down').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('race_lap_traces_race_session_driver_idx').on(t.raceId, t.sessionType, t.driverId),
]);

// Spells of 3+ consecutive laps within 1.0 s of the same car ahead (race_story.find_battles).
export const raceBattles = pgTable('race_battles', {
  id: serial('id').primaryKey(),
  raceId: integer('race_id').notNull().references(() => races.id),
  sessionType: varchar('session_type', { length: 10 }).notNull().default('race'),
  chaserDriverId: integer('chaser_driver_id').notNull().references(() => drivers.id),
  leaderDriverId: integer('leader_driver_id').notNull().references(() => drivers.id),
  lapStart: integer('lap_start').notNull(),
  lapEnd: integer('lap_end').notNull(),
  minGapMs: integer('min_gap_ms').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('race_battles_race_session_chaser_lap_idx').on(t.raceId, t.sessionType, t.chaserDriverId, t.lapStart),
]);

// One row per session: FastF1's minute-by-minute weather as arrays (temps in tenths of °C).
export const raceWeatherTraces = pgTable('race_weather_traces', {
  id: serial('id').primaryKey(),
  raceId: integer('race_id').notNull().references(() => races.id),
  sessionType: varchar('session_type', { length: 10 }).notNull().default('race'),
  minuteOffsets: integer('minute_offsets').array().notNull(),
  airTempTenths: integer('air_temp_tenths').array().notNull(),
  trackTempTenths: integer('track_temp_tenths').array().notNull(),
  rainfall: boolean('rainfall').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('race_weather_traces_race_session_idx').on(t.raceId, t.sessionType),
]);
