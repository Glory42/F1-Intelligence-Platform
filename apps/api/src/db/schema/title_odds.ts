import { pgTable, serial, integer, numeric, varchar, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { seasons } from './seasons';
import { drivers } from './drivers';
import { teams } from './teams';

// Monte Carlo championship odds, one row per contender per round so the odds can be charted
// over the season. after_round = last completed round when computed (0 before the opener).
export const titleOddsDrivers = pgTable('title_odds_drivers', {
  id: serial('id').primaryKey(),
  seasonId: integer('season_id').notNull().references(() => seasons.id),
  afterRound: integer('after_round').notNull(),
  driverId: integer('driver_id').notNull().references(() => drivers.id),
  titleProbability: numeric('title_probability', { precision: 6, scale: 5 }).notNull(),
  expectedPoints: numeric('expected_points', { precision: 6, scale: 1 }).notNull(),
  pointsP10: numeric('points_p10', { precision: 6, scale: 1 }).notNull(),
  pointsP90: numeric('points_p90', { precision: 6, scale: 1 }).notNull(),
  simulations: integer('simulations').notNull(),
  modelVersion: varchar('model_version', { length: 30 }).notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('title_odds_drivers_season_round_driver_idx').on(t.seasonId, t.afterRound, t.driverId),
]);

export const titleOddsTeams = pgTable('title_odds_teams', {
  id: serial('id').primaryKey(),
  seasonId: integer('season_id').notNull().references(() => seasons.id),
  afterRound: integer('after_round').notNull(),
  teamId: integer('team_id').notNull().references(() => teams.id),
  titleProbability: numeric('title_probability', { precision: 6, scale: 5 }).notNull(),
  expectedPoints: numeric('expected_points', { precision: 6, scale: 1 }).notNull(),
  pointsP10: numeric('points_p10', { precision: 6, scale: 1 }).notNull(),
  pointsP90: numeric('points_p90', { precision: 6, scale: 1 }).notNull(),
  simulations: integer('simulations').notNull(),
  modelVersion: varchar('model_version', { length: 30 }).notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('title_odds_teams_season_round_team_idx').on(t.seasonId, t.afterRound, t.teamId),
]);
