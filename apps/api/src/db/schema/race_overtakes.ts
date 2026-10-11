import { pgTable, serial, integer, varchar, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { races } from './races';
import { drivers } from './drivers';

export const raceOvertakes = pgTable('race_overtakes', {
  id: serial('id').primaryKey(),
  raceId: integer('race_id').notNull().references(() => races.id),
  date: timestamp('date', { withTimezone: true }).notNull(),
  overtakingDriverId: integer('overtaking_driver_id').notNull().references(() => drivers.id),
  overtakenDriverId: integer('overtaken_driver_id').notNull().references(() => drivers.id),
  position: integer('position').notNull(),
  // 'race' | 'sprint': both sessions of a sprint weekend share one race_id.
  sessionType: varchar('session_type', { length: 10 }).notNull().default('race'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('race_overtakes_race_date_pair_idx').on(t.raceId, t.date, t.overtakingDriverId, t.overtakenDriverId),
  index('race_overtakes_race_idx').on(t.raceId),
]);
