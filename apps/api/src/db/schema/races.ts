import { pgTable, serial, integer, varchar, numeric, date, timestamp, uniqueIndex, index, pgEnum } from 'drizzle-orm/pg-core';
import { seasons } from './seasons';
import { circuits } from './circuits';

export const raceStatusEnum = pgEnum('race_status', [
  'scheduled',
  'sprint_qualifying_done',
  'sprint_done',
  'qualifying_done',
  'completed',
]);

export const races = pgTable('races', {
  id: serial('id').primaryKey(),
  seasonId: integer('season_id').notNull().references(() => seasons.id),
  circuitId: integer('circuit_id').notNull().references(() => circuits.id),
  roundNumber: integer('round_number').notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  raceDate: date('race_date').notNull(),
  raceDateUtc: timestamp('race_date_utc', { withTimezone: true }),
  status: raceStatusEnum('status').notNull().default('scheduled'),
  eventFormat: varchar('event_format', { length: 30 }).notNull().default('conventional'),
  qualifyingDate: timestamp('qualifying_date', { withTimezone: true }),
  sprintDate: timestamp('sprint_date', { withTimezone: true }),
  sprintQualifyingDate: timestamp('sprint_qualifying_date', { withTimezone: true }),
  weather: varchar('weather', { length: 30 }),
  safetyCarLaps: integer('safety_car_laps').default(0),
  vscLaps: integer('vsc_laps').default(0),
  airTempAvg: numeric('air_temp_avg', { precision: 4, scale: 1 }),
  trackTempAvg: numeric('track_temp_avg', { precision: 4, scale: 1 }),
  humidityAvg: numeric('humidity_avg', { precision: 4, scale: 1 }),
  sprintWeather: varchar('sprint_weather', { length: 30 }),
  sprintSafetyCarLaps: integer('sprint_safety_car_laps'),
  sprintVscLaps: integer('sprint_vsc_laps'),
  sprintAirTempAvg: numeric('sprint_air_temp_avg', { precision: 4, scale: 1 }),
  sprintTrackTempAvg: numeric('sprint_track_temp_avg', { precision: 4, scale: 1 }),
  sprintHumidityAvg: numeric('sprint_humidity_avg', { precision: 4, scale: 1 }),
  // Cached once resolved so later OpenF1 jobs skip the /sessions lookup (Free-tier request budget).
  openf1RaceSessionKey: integer('openf1_race_session_key'),
  openf1SprintSessionKey: integer('openf1_sprint_session_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('races_season_round_idx').on(t.seasonId, t.roundNumber),
  index('races_circuit_status_idx').on(t.circuitId, t.status),
  index('races_status_date_idx').on(t.status, t.raceDate),
]);
