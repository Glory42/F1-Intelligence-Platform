import { pgTable, serial, integer, varchar, numeric, date, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';

// All-time history from F1DB (github.com/f1db/f1db, CC-BY-4.0), imported by data-engine's
// import_f1db. Kept separate from the season-scoped core tables that feed the prediction model.
export const historyDrivers = pgTable('history_drivers', {
  id: serial('id').primaryKey(),
  f1dbId: varchar('f1db_id', { length: 100 }).notNull(),
  // normalize_person_name(name): the join key to core drivers (see modules/history/f1db-match.helpers.ts).
  matchKey: varchar('match_key', { length: 120 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  abbreviation: varchar('abbreviation', { length: 3 }),
  dateOfBirth: date('date_of_birth'),
  dateOfDeath: date('date_of_death'),
  nationality: varchar('nationality', { length: 60 }),
  championships: integer('championships').notNull().default(0),
  raceStarts: integer('race_starts').notNull().default(0),
  raceWins: integer('race_wins').notNull().default(0),
  podiums: integer('podiums').notNull().default(0),
  polePositions: integer('pole_positions').notNull().default(0),
  fastestLaps: integer('fastest_laps').notNull().default(0),
  careerPoints: numeric('career_points', { precision: 8, scale: 2 }).notNull().default('0'),
  sprintWins: integer('sprint_wins').notNull().default(0),
  grandSlams: integer('grand_slams').notNull().default(0),
  firstRaceDate: date('first_race_date'),
  firstRaceName: varchar('first_race_name', { length: 200 }),
  firstWinDate: date('first_win_date'),
  firstWinName: varchar('first_win_name', { length: 200 }),
  firstPodiumDate: date('first_podium_date'),
  firstPodiumName: varchar('first_podium_name', { length: 200 }),
  firstPoleDate: date('first_pole_date'),
  firstPoleName: varchar('first_pole_name', { length: 200 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('history_drivers_f1db_idx').on(t.f1dbId),
  index('history_drivers_match_key_idx').on(t.matchKey),
]);

export const historyConstructors = pgTable('history_constructors', {
  id: serial('id').primaryKey(),
  f1dbId: varchar('f1db_id', { length: 100 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  fullName: varchar('full_name', { length: 200 }),
  country: varchar('country', { length: 60 }),
  championships: integer('championships').notNull().default(0),
  raceStarts: integer('race_starts').notNull().default(0),
  raceWins: integer('race_wins').notNull().default(0),
  podiums: integer('podiums').notNull().default(0),
  polePositions: integer('pole_positions').notNull().default(0),
  fastestLaps: integer('fastest_laps').notNull().default(0),
  careerPoints: numeric('career_points', { precision: 9, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('history_constructors_f1db_idx').on(t.f1dbId)]);

export const historyConstructorSeasons = pgTable('history_constructor_seasons', {
  id: serial('id').primaryKey(),
  constructorF1dbId: varchar('constructor_f1db_id', { length: 100 }).notNull(),
  year: integer('year').notNull(),
  chassis: varchar('chassis', { length: 200 }),
  engine: varchar('engine', { length: 200 }),
}, (t) => [uniqueIndex('history_constructor_seasons_idx').on(t.constructorF1dbId, t.year)]);

// F1DB's "chronology": e.g. Sauber → BMW Sauber → Sauber → Alfa Romeo under one lineage.
export const historyConstructorLineage = pgTable('history_constructor_lineage', {
  id: serial('id').primaryKey(),
  parentF1dbId: varchar('parent_f1db_id', { length: 100 }).notNull(),
  position: integer('position').notNull(),
  constructorF1dbId: varchar('constructor_f1db_id', { length: 100 }).notNull(),
  yearFrom: integer('year_from').notNull(),
  yearTo: integer('year_to'),
}, (t) => [uniqueIndex('history_constructor_lineage_idx').on(t.parentF1dbId, t.position)]);

export const f1dbImports = pgTable('f1db_imports', {
  id: serial('id').primaryKey(),
  version: varchar('version', { length: 30 }).notNull(),
  importedAt: timestamp('imported_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('f1db_imports_version_idx').on(t.version)]);
