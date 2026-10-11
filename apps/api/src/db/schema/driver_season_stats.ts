import { pgTable, serial, integer, numeric, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { seasons } from './seasons';
import { drivers } from './drivers';

export const driverSeasonStats = pgTable('driver_season_stats', {
  id: serial('id').primaryKey(),
  seasonId: integer('season_id').notNull().references(() => seasons.id),
  driverId: integer('driver_id').notNull().references(() => drivers.id),
  racesEntered: integer('races_entered').notNull().default(0),
  racesFinished: integer('races_finished').notNull().default(0),
  wins: integer('wins').notNull().default(0),
  podiums: integer('podiums').notNull().default(0),
  poles: integer('poles').notNull().default(0),
  totalPoints: numeric('total_points', { precision: 6, scale: 1 }).notNull().default('0'),
  championshipPosition: integer('championship_position'),
  avgFinishPosition: numeric('avg_finish_position', { precision: 4, scale: 2 }),
  winRate: numeric('win_rate', { precision: 5, scale: 4 }),
  avgPositionGain: numeric('avg_position_gain', { precision: 4, scale: 2 }),
  dnfCount: integer('dnf_count').notNull().default(0),
  dnfRate: numeric('dnf_rate', { precision: 4, scale: 3 }),
  avgSector1Ms: integer('avg_sector1_ms'),
  avgSector2Ms: integer('avg_sector2_ms'),
  avgSector3Ms: integer('avg_sector3_ms'),
  topSpeedAvg: numeric('top_speed_avg', { precision: 5, scale: 1 }),
  teammateQualiDelta: numeric('teammate_quali_delta', { precision: 6, scale: 4 }),
  // Sprint-specific aggregates: kept separate because sprint max points (8) ≠ race max points (25)
  sprintRacesEntered: integer('sprint_races_entered').notNull().default(0),
  sprintWins: integer('sprint_wins').notNull().default(0),
  sprintPodiums: integer('sprint_podiums').notNull().default(0),
  sprintTotalPoints: numeric('sprint_total_points', { precision: 6, scale: 1 }).notNull().default('0'),
  sprintAvgFinishPosition: numeric('sprint_avg_finish_position', { precision: 4, scale: 2 }),
  sprintWinRate: numeric('sprint_win_rate', { precision: 5, scale: 4 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('driver_season_stats_season_driver_idx').on(t.seasonId, t.driverId),
  index('driver_season_stats_driver_idx').on(t.driverId),
]);
