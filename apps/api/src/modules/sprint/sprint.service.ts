import { eq, asc, inArray, and, gte, sql } from 'drizzle-orm';
import type { Db } from '../../config/database';
import {
  races, circuits, sprintPredictions, driverSprintFeatures,
  sprintResults, sprintLapTimes, drivers, teams,
} from '../../db/schema';
import type {
  SprintPredictionResponse,
  SprintResult, SprintDetailResponse, SprintFeatureScores, LapSummary,
} from '../../common/types';
import { SPRINT_FORMATS } from '../../common/constants';
import { toDriver, toRace, toSprintResult } from '../../common/mappers';
import { buildPredictionResponse as buildSharedPredictionResponse } from '../../common/prediction-response';
import { SPRINT_FEATURE_MANIFEST, mapFeatureRow } from '../../common/feature-manifest';

function toSprintFeatures(f: typeof driverSprintFeatures.$inferSelect): SprintFeatureScores {
  return mapFeatureRow(f, SPRINT_FEATURE_MANIFEST);
}

export class SprintService {
  async findUpcoming(db: Db): Promise<SprintPredictionResponse | null> {
    return this.buildPredictionResponse(db, 'upcoming');
  }

  async findByRaceId(db: Db, raceId: number): Promise<SprintPredictionResponse | null> {
    return this.buildPredictionResponse(db, raceId);
  }

  async findDetail(
    db: Db,
    race: typeof races.$inferSelect,
    circuit: typeof circuits.$inferSelect,
  ): Promise<SprintDetailResponse | null> {
    const raceId = race.id;
    if (!(SPRINT_FORMATS as readonly string[]).includes(race.eventFormat)) return null;

    const [prediction, resultRows, lapRows] = await Promise.all([
      this.buildPredictionResponse(db, raceId),
      db
        .select()
        .from(sprintResults)
        .innerJoin(drivers, eq(sprintResults.driverId, drivers.id))
        .innerJoin(teams, eq(drivers.teamId, teams.id))
        .where(eq(sprintResults.raceId, raceId))
        .orderBy(asc(sprintResults.finishPosition)),
      db
        .select()
        .from(sprintLapTimes)
        .innerJoin(drivers, eq(sprintLapTimes.driverId, drivers.id))
        .innerJoin(teams, eq(drivers.teamId, teams.id))
        .where(eq(sprintLapTimes.raceId, raceId)),
    ]);

    // Return all rows (including grid_set placeholder rows) so frontend can render qualifying times
    const completedResults: SprintResult[] = resultRows.map(toSprintResult);

    const lapsByDriver = new Map<number, { lapTimes: number[]; total: number; driver: typeof drivers.$inferSelect; team: typeof teams.$inferSelect }>();
    for (const row of lapRows) {
      const driverId = row.sprint_lap_times.driverId;
      if (!lapsByDriver.has(driverId)) {
        lapsByDriver.set(driverId, { lapTimes: [], total: 0, driver: row.drivers, team: row.teams });
      }
      const entry = lapsByDriver.get(driverId)!;
      entry.total += 1;
      if (row.sprint_lap_times.lapTimeMs) entry.lapTimes.push(row.sprint_lap_times.lapTimeMs);
    }

    const laps: LapSummary[] = [...lapsByDriver.values()].map(({ lapTimes, total, driver: d, team: t }) => ({
      driverId: d.id,
      fastestLapMs: lapTimes.length > 0 ? Math.min(...lapTimes) : null,
      avgLapMs: lapTimes.length > 0 ? Math.round(lapTimes.reduce((a, b) => a + b, 0) / lapTimes.length) : null,
      totalLaps: total,
      driver: toDriver(d, t),
    })).sort((a, b) => (a.fastestLapMs ?? Infinity) - (b.fastestLapMs ?? Infinity));

    return {
      race: toRace(race, circuit),
      prediction,
      results: completedResults,
      laps,
    };
  }

  private async buildPredictionResponse(
    db: Db,
    target: 'upcoming' | number,
  ): Promise<SprintPredictionResponse | null> {
    return buildSharedPredictionResponse<typeof driverSprintFeatures.$inferSelect, SprintFeatureScores>(db, {
      target,
      queryUpcoming: (db) =>
        db
          .select()
          .from(sprintPredictions)
          .innerJoin(races, eq(sprintPredictions.raceId, races.id))
          .innerJoin(circuits, eq(races.circuitId, circuits.id))
          .where(and(
            inArray(races.status, ['sprint_qualifying_done', 'sprint_done', 'qualifying_done']),
            gte(sql`DATE(${races.sprintDate})`, sql`CURRENT_DATE`),
          ))
          .orderBy(asc(races.sprintDate))
          .limit(1)
          .then((rows) => rows.map((r) => ({ prediction: r.sprint_predictions, race: r.races, circuit: r.circuits }))),
      queryById: (db, raceId) =>
        db
          .select()
          .from(sprintPredictions)
          .innerJoin(races, eq(sprintPredictions.raceId, races.id))
          .innerJoin(circuits, eq(races.circuitId, circuits.id))
          .where(eq(sprintPredictions.raceId, raceId))
          .limit(1)
          .then((rows) => rows.map((r) => ({ prediction: r.sprint_predictions, race: r.races, circuit: r.circuits }))),
      fetchFeatureRows: (db, raceId) =>
        db
          .select()
          .from(driverSprintFeatures)
          .innerJoin(drivers, eq(driverSprintFeatures.driverId, drivers.id))
          .innerJoin(teams, eq(drivers.teamId, teams.id))
          .where(eq(driverSprintFeatures.raceId, raceId))
          .orderBy(asc(driverSprintFeatures.predictedPosition))
          .then((rows) => rows.map((r) => ({
            driverId: r.drivers.id,
            driver: r.drivers,
            team: r.teams,
            winProbability: r.driver_sprint_features.winProbability,
            predictedPosition: r.driver_sprint_features.predictedPosition,
            raw: r.driver_sprint_features,
          }))),
      toFeatures: toSprintFeatures,
    });
  }
}
