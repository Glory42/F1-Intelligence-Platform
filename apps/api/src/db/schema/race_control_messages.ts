import { pgTable, serial, integer, varchar, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { races } from './races';

export const raceControlMessages = pgTable('race_control_messages', {
  id: serial('id').primaryKey(),
  raceId: integer('race_id').notNull().references(() => races.id),
  date: timestamp('date', { withTimezone: true }).notNull(),
  category: varchar('category', { length: 30 }).notNull(),
  flag: varchar('flag', { length: 20 }),
  lapNumber: integer('lap_number'),
  driverNumber: integer('driver_number'),
  scope: varchar('scope', { length: 20 }),
  sector: integer('sector'),
  message: text('message').notNull(),
  // 'race' | 'sprint': both sessions of a sprint weekend share one race_id.
  sessionType: varchar('session_type', { length: 10 }).notNull().default('race'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('race_control_messages_race_date_message_idx').on(t.raceId, t.date, t.message),
  index('race_control_messages_race_idx').on(t.raceId),
]);
