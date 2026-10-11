import { eq, desc, asc, inArray, and } from 'drizzle-orm';
import type { Db } from '../../config/database';
import {
  races, circuits, racePredictions, driverPredictionFeatures,
  drivers, teams, raceResults, seasons, driverSeasonStats,
  sprintPredictions, sprintResults, driverSprintFeatures,
} from '../../db/schema';
import type {
  PredictionResponse,
  PredictionHistoryItem, IntelStandingRow, ModelInfo, SeasonAccuracy,
} from '../../common/types';
import { resolveSeason } from '../../common/standings';
import { aggregateAccuracyBySeason } from './accuracy.helpers';
import {
  buildHistoryItems,
  buildProbPosMaps,
  buildWinnerMap,
  mergeHistoryByDateDesc,
  type HistoryPredictionRow,
  type HistoryProbRow,
  type HistoryWinnerRow,
} from './prediction-history.helpers';
import { aggregateSeasonFeatures, buildIntelStandingRows } from './intel-standings.helpers';
import { buildGpPredictionResponse } from './predictions.helpers';

const GP_DONE = (status: string) => status === 'completed';
const SPRINT_DONE = (status: string) =>
  ['sprint_done', 'qualifying_done', 'completed'].includes(status);

type WinnerTable = typeof raceResults | typeof sprintResults;
type ProbTable = typeof driverPredictionFeatures | typeof driverSprintFeatures;

export class PredictionsService {
  async findUpcoming(db: Db): Promise<PredictionResponse | null> {
    return buildGpPredictionResponse(db, 'upcoming');
  }

  async findByRaceId(db: Db, raceId: number): Promise<PredictionResponse | null> {
    return buildGpPredictionResponse(db, raceId);
  }

  // `year` omitted returns every season: used by findAccuracyBySeason() to aggregate across all years.
  async findHistory(db: Db, year?: number): Promise<PredictionHistoryItem[]> {
    const yearFilter = year !== undefined ? eq(seasons.year, year) : undefined;
    const [gpRows, sprintRows] = await Promise.all([
      this.fetchPredictionRows(db, racePredictions, yearFilter),
      this.fetchPredictionRows(db, sprintPredictions, yearFilter),
    ]);

    const gpIds = gpRows.map((r) => r.race.id);
    const sprintIds = sprintRows.map((r) => r.race.id);
    const gpDoneIds = gpRows.filter((r) => GP_DONE(r.race.status)).map((r) => r.race.id);
    const sprintDoneIds = sprintRows.filter((r) => SPRINT_DONE(r.race.status)).map((r) => r.race.id);

    const [gpWinners, sprintWinners, gpProbs, sprintProbs] = await Promise.all([
      this.fetchWinners(db, raceResults, gpDoneIds),
      this.fetchWinners(db, sprintResults, sprintDoneIds),
      this.fetchProbs(db, driverPredictionFeatures, gpIds),
      this.fetchProbs(db, driverSprintFeatures, sprintIds),
    ]);

    const gpItems = buildHistoryItems(gpRows, {
      actualWinnerMap: buildWinnerMap(gpWinners),
      ...buildProbPosMaps(gpProbs),
      isDone: GP_DONE,
      isSprint: false,
    });
    const sprintItems = buildHistoryItems(sprintRows, {
      actualWinnerMap: buildWinnerMap(sprintWinners),
      ...buildProbPosMaps(sprintProbs),
      isDone: SPRINT_DONE,
      isSprint: true,
    });

    return mergeHistoryByDateDesc(gpItems, sprintItems);
  }

  private async fetchPredictionRows(
    db: Db,
    table: typeof racePredictions | typeof sprintPredictions,
    yearFilter: ReturnType<typeof eq> | undefined,
  ): Promise<HistoryPredictionRow[]> {
    const rows = await db
      .select({
        race: races,
        circuit: circuits,
        driver: drivers,
        team: teams,
        computedAt: table.computedAt,
      })
      .from(table)
      .innerJoin(races, eq(table.raceId, races.id))
      .innerJoin(seasons, eq(races.seasonId, seasons.id))
      .innerJoin(circuits, eq(races.circuitId, circuits.id))
      .innerJoin(drivers, eq(table.predictedWinnerId, drivers.id))
      .innerJoin(teams, eq(drivers.teamId, teams.id))
      .where(yearFilter)
      .orderBy(desc(races.raceDate));
    return rows;
  }

  private async fetchWinners(
    db: Db,
    table: WinnerTable,
    raceIds: number[],
  ): Promise<HistoryWinnerRow[]> {
    if (raceIds.length === 0) return [];
    return db
      .select({ raceId: table.raceId, driver: drivers, team: teams })
      .from(table)
      .innerJoin(drivers, eq(table.driverId, drivers.id))
      .innerJoin(teams, eq(drivers.teamId, teams.id))
      .where(and(inArray(table.raceId, raceIds), eq(table.finishPosition, 1)));
  }

  private async fetchProbs(
    db: Db,
    table: ProbTable,
    raceIds: number[],
  ): Promise<HistoryProbRow[]> {
    if (raceIds.length === 0) return [];
    return db
      .select({
        raceId: table.raceId,
        driverId: table.driverId,
        winProbability: table.winProbability,
        predictedPosition: table.predictedPosition,
      })
      .from(table)
      .where(inArray(table.raceId, raceIds));
  }

  async findAccuracyBySeason(db: Db): Promise<SeasonAccuracy[]> {
    const allHistory = await this.findHistory(db);
    return aggregateAccuracyBySeason(allHistory);
  }

  async findIntelStandings(db: Db, year: number): Promise<IntelStandingRow[]> {
    const season = await resolveSeason(db, year);
    if (!season) return [];

    const raceIdsRows = await db
      .select({ id: races.id })
      .from(races)
      .innerJoin(racePredictions, eq(racePredictions.raceId, races.id))
      .where(eq(races.seasonId, season.id));

    if (!raceIdsRows.length) return [];
    const raceIds = raceIdsRows.map((r) => r.id);

    const featureRows = await db
      .select()
      .from(driverPredictionFeatures)
      .innerJoin(drivers, eq(driverPredictionFeatures.driverId, drivers.id))
      .innerJoin(teams, eq(drivers.teamId, teams.id))
      .innerJoin(races, eq(driverPredictionFeatures.raceId, races.id))
      .where(inArray(driverPredictionFeatures.raceId, raceIds))
      .orderBy(asc(races.raceDate));

    if (!featureRows.length) return [];

    const aggregated = aggregateSeasonFeatures(featureRows);
    const driverIds = aggregated.map((r) => r.driver.id);

    const sprintStatsRows = driverIds.length > 0
      ? await db
          .select({
            driverId: driverSeasonStats.driverId,
            sprintWins: driverSeasonStats.sprintWins,
            sprintPodiums: driverSeasonStats.sprintPodiums,
            sprintTotalPoints: driverSeasonStats.sprintTotalPoints,
          })
          .from(driverSeasonStats)
          .where(and(
            inArray(driverSeasonStats.driverId, driverIds),
            eq(driverSeasonStats.seasonId, season.id),
          ))
      : [];

    return buildIntelStandingRows(aggregated, new Map(sprintStatsRows.map((s) => [s.driverId, s])));
  }

  async getModelInfo(db: Db): Promise<ModelInfo> {
    const [gp, sprint] = await Promise.all([
      db.select({ version: racePredictions.modelVersion })
        .from(racePredictions)
        .orderBy(desc(racePredictions.computedAt))
        .limit(1),
      db.select({ version: sprintPredictions.modelVersion })
        .from(sprintPredictions)
        .orderBy(desc(sprintPredictions.computedAt))
        .limit(1),
    ]);
    return {
      gpVersion: gp[0]?.version ?? 'weighted-v3',
      sprintVersion: sprint[0]?.version ?? 'sprint-v2',
    };
  }
}
