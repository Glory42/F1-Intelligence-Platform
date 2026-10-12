import { eq, desc, asc, inArray, and } from 'drizzle-orm';
import type { Db } from '../../config/database';
import {
  races, circuits, racePredictions, driverPredictionFeatures,
  drivers, teams, seasons, driverSeasonStats, sprintPredictions,
} from '../../db/schema';
import type { PredictionHistoryItem, IntelStandingRow, ModelInfo, SeasonAccuracy } from '../../common/types';
import { resolveSeason } from '../../common/standings';
import { GP, SPRINT, isDone, type AnySessionKind } from '../../common/session-kind';
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

export class PredictionsService {
  // The Scorecard: GP and sprint predictions side by side. `year` omitted spans every season
  // (findAccuracyBySeason aggregates over all of them).
  async findHistory(db: Db, year?: number): Promise<PredictionHistoryItem[]> {
    const yearFilter = year !== undefined ? eq(seasons.year, year) : undefined;
    const [gpItems, sprintItems] = await Promise.all([
      this.scorecardItems(db, GP, yearFilter),
      this.scorecardItems(db, SPRINT, yearFilter),
    ]);
    return mergeHistoryByDateDesc(gpItems, sprintItems);
  }

  private async scorecardItems(
    db: Db,
    kind: AnySessionKind,
    yearFilter: ReturnType<typeof eq> | undefined,
  ): Promise<PredictionHistoryItem[]> {
    const rows = await this.fetchPredictionRows(db, kind.predictions, yearFilter);
    const doneIds = rows.filter((r) => isDone(kind, r.race.status)).map((r) => r.race.id);
    const [winners, probs] = await Promise.all([
      this.fetchWinners(db, kind.results, doneIds),
      this.fetchProbs(db, kind.features, rows.map((r) => r.race.id)),
    ]);
    return buildHistoryItems(rows, {
      actualWinnerMap: buildWinnerMap(winners),
      ...buildProbPosMaps(probs),
      isDone: (status) => isDone(kind, status),
      isSprint: kind.session === 'sprint',
    });
  }

  private async fetchPredictionRows(
    db: Db,
    table: AnySessionKind['predictions'],
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
    table: AnySessionKind['results'],
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
    table: AnySessionKind['features'],
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
