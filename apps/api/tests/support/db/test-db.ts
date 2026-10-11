import { sql } from 'drizzle-orm';
import { createDb, type Db } from '../../../src/config/database';
import { configureLocalNeonProxy } from '../../../src/config/localNeonProxy';
import {
  seasons, circuits, teams, drivers, races, raceResults, qualifyingResults,
  lapTimes, sprintResults, sprintLapTimes, driverSeasonStats, teamSeasonStats,
  racePredictions, sprintPredictions, driverPredictionFeatures, driverSprintFeatures,
  fp2LongRunTimes, dataQualityIssues, dataQualityRuns, raceControlMessages, raceOvertakes,
  teamRadioClips, raceStints, racePitStops, titleOddsDrivers, titleOddsTeams,
  raceLapTraces, raceBattles, raceWeatherTraces, qualifyingLapTelemetry,
  historyDrivers, historyConstructors, historyConstructorSeasons, historyConstructorLineage, f1dbImports,
} from '../../../src/db/schema';

export const getTestDatabaseUrl = (): string => {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? '';
  if (!databaseUrl) {
    throw new Error(
      'TEST_DATABASE_URL is required for apps/api integration tests. Point it at a dedicated Neon test branch (see apps/api/.env.example).'
    );
  }
  return databaseUrl;
};

// Neon hostnames never contain "test", so string-matching isn't meaningful here: the real
// safety boundary is that TEST_DATABASE_URL must differ from DATABASE_URL.
const assertResetAllowed = (testDatabaseUrl: string): void => {
  const allowManualOverride = process.env.TEST_DB_ALLOW_RESET === '1';
  if (allowManualOverride) return;

  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (databaseUrl && databaseUrl === testDatabaseUrl) {
    throw new Error(
      'Refusing to truncate: TEST_DATABASE_URL is identical to DATABASE_URL. ' +
      'Set TEST_DB_ALLOW_RESET=1 to override.'
    );
  }
};

// Neon Free's 100 CU-hours are shared by every branch, and the TDD loop runs these tests
// constantly: so only docker-compose.test.yml is allowed unless explicitly overridden.
const assertNotNeon = (testDatabaseUrl: string): void => {
  if (process.env.TEST_DB_ALLOW_NEON === '1') return;
  if (new URL(testDatabaseUrl).hostname.endsWith('neon.tech')) {
    throw new Error(
      'Refusing to run integration tests against Neon (spends Free-tier CU-hours). ' +
      'Run `bun run test:db:up` and use apps/api/.env.test, or set TEST_DB_ALLOW_NEON=1.'
    );
  }
};

let cachedDb: Db | null = null;

export const getTestDb = (): Db => {
  if (!cachedDb) {
    const url = getTestDatabaseUrl();
    assertResetAllowed(url);
    assertNotNeon(url);
    configureLocalNeonProxy();
    cachedDb = createDb(url);
  }
  return cachedDb;
};

const ALL_TABLES = [
  historyDrivers, historyConstructors, historyConstructorSeasons, historyConstructorLineage, f1dbImports,
  titleOddsDrivers, titleOddsTeams, raceLapTraces, raceBattles, raceWeatherTraces, qualifyingLapTelemetry,
  dataQualityIssues, dataQualityRuns,
  driverPredictionFeatures, driverSprintFeatures,
  racePredictions, sprintPredictions,
  fp2LongRunTimes, sprintLapTimes, lapTimes,
  sprintResults, raceResults, qualifyingResults,
  raceControlMessages, raceOvertakes, teamRadioClips, raceStints, racePitStops,
  driverSeasonStats, teamSeasonStats,
  races, drivers, teams, circuits, seasons,
];

export const truncateAll = async (db: Db): Promise<void> => {
  // CASCADE handles FK ordering for us: one statement covering every table.
  const tableList = sql.join(ALL_TABLES.map((t) => sql`${t}`), sql.raw(', '));
  await db.execute(sql`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
};
