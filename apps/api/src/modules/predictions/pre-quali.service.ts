import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../config/database';
import { circuits, drivers, preQualiPredictions, races, teams } from '../../db/schema';
import type { PreQualiForecast } from '../../common/types';
import { toDriver, toRace } from '../../common/mappers';

// Until qualifying is ingested the GP has no Prediction yet: this forecast stands in for it.
const BEFORE_QUALIFYING = ['scheduled', 'sprint_qualifying_done', 'sprint_done'] as const;

export class PreQualiService {
  async findUpcoming(db: Db): Promise<PreQualiForecast | null> {
    const [next] = await db
      .select({ race: races, circuit: circuits })
      .from(preQualiPredictions)
      .innerJoin(races, eq(preQualiPredictions.raceId, races.id))
      .innerJoin(circuits, eq(races.circuitId, circuits.id))
      .where(and(inArray(races.status, [...BEFORE_QUALIFYING]), gte(sql`DATE(${races.raceDate})`, sql`CURRENT_DATE`)))
      .orderBy(asc(races.raceDate))
      .limit(1);
    if (!next) return null;
    const rows = await db
      .select({ forecast: preQualiPredictions, driver: drivers, team: teams })
      .from(preQualiPredictions)
      .innerJoin(drivers, eq(preQualiPredictions.driverId, drivers.id))
      .innerJoin(teams, eq(drivers.teamId, teams.id))
      .where(eq(preQualiPredictions.raceId, next.race.id))
      .orderBy(asc(preQualiPredictions.predictedPosition));
    return {
      race: toRace(next.race, next.circuit),
      computedAt: rows[0].forecast.computedAt.toISOString(),
      modelVersion: rows[0].forecast.modelVersion,
      drivers: rows.map((r) => ({
        driver: toDriver(r.driver, r.team),
        winProbability: r.forecast.winProbability,
        predictedPosition: r.forecast.predictedPosition,
      })),
    };
  }
}
