import { pgTable, serial, integer, varchar, timestamp, text, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { races } from './races';
import { drivers } from './drivers';

export const teamRadioClips = pgTable('team_radio_clips', {
  id: serial('id').primaryKey(),
  raceId: integer('race_id').notNull().references(() => races.id),
  driverId: integer('driver_id').notNull().references(() => drivers.id),
  date: timestamp('date', { withTimezone: true }).notNull(),
  recordingUrl: text('recording_url').notNull(),
  // 'race' | 'sprint': both sessions of a sprint weekend share one race_id.
  sessionType: varchar('session_type', { length: 10 }).notNull().default('race'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('team_radio_clips_race_driver_date_idx').on(t.raceId, t.driverId, t.date),
  index('team_radio_clips_race_idx').on(t.raceId),
]);
