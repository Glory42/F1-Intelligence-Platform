import { pgTable, serial, integer, varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { races } from './races';
import { drivers } from './drivers';

export const racePredictions = pgTable('race_predictions', {
  id: serial('id').primaryKey(),
  raceId: integer('race_id').notNull().references(() => races.id).unique(),
  predictedWinnerId: integer('predicted_winner_id').notNull().references(() => drivers.id),
  computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
  modelVersion: varchar('model_version', { length: 20 }).notNull().default('weighted-v4'),
  notes: text('notes'),
});
