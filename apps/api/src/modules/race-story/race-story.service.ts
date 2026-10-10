import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../config/database';
import { drivers, raceBattles, raceLapTraces, raceResults, raceWeatherTraces, sprintResults, teams } from '../../db/schema';
import type { Driver, RaceSession, RaceStoryResponse } from '../../common/types';
import { toDriver } from '../../common/mappers';

export class RaceStoryService {
  async findRaceStory(db: Db, raceId: number, session: RaceSession): Promise<RaceStoryResponse> {
    const results = session === 'sprint' ? sprintResults : raceResults;
    const [traceRows, battleRows, finishRows, weatherRows] = await Promise.all([
      db
        .select({ trace: raceLapTraces, driver: drivers, team: teams })
        .from(raceLapTraces)
        .innerJoin(drivers, eq(raceLapTraces.driverId, drivers.id))
        .innerJoin(teams, eq(drivers.teamId, teams.id))
        .where(and(eq(raceLapTraces.raceId, raceId), eq(raceLapTraces.sessionType, session))),
      db
        .select()
        .from(raceBattles)
        .where(and(eq(raceBattles.raceId, raceId), eq(raceBattles.sessionType, session)))
        .orderBy(asc(raceBattles.lapStart)),
      db
        .select({ driverId: results.driverId, finishPosition: results.finishPosition })
        .from(results)
        .where(eq(results.raceId, raceId)),
      db
        .select()
        .from(raceWeatherTraces)
        .where(and(eq(raceWeatherTraces.raceId, raceId), eq(raceWeatherTraces.sessionType, session)))
        .limit(1),
    ]);

    const finish = new Map(finishRows.map((r) => [r.driverId, r.finishPosition]));
    const byId = new Map<number, Driver>(traceRows.map((r) => [r.driver.id, toDriver(r.driver, r.team)]));
    const missing = battleRows
      .flatMap((b) => [b.chaserDriverId, b.leaderDriverId])
      .filter((id) => !byId.has(id));
    if (missing.length > 0) {
      const extra = await db
        .select({ driver: drivers, team: teams })
        .from(drivers)
        .innerJoin(teams, eq(drivers.teamId, teams.id))
        .where(inArray(drivers.id, missing));
      for (const r of extra) byId.set(r.driver.id, toDriver(r.driver, r.team));
    }

    return {
      drivers: traceRows
        .map((r) => ({
          driver: byId.get(r.driver.id)!,
          finishPosition: finish.get(r.driver.id) ?? null,
          positions: r.trace.positions,
          gapsMs: r.trace.gapsMs,
          intervalsMs: r.trace.intervalsMs,
          lapsDown: r.trace.lapsDown,
        }))
        .sort((a, b) => (a.finishPosition ?? 99) - (b.finishPosition ?? 99)),
      battles: battleRows
        .filter((b) => byId.has(b.chaserDriverId) && byId.has(b.leaderDriverId))
        .map((b) => ({
          chaser: byId.get(b.chaserDriverId)!,
          leader: byId.get(b.leaderDriverId)!,
          lapStart: b.lapStart,
          lapEnd: b.lapEnd,
          minGapMs: b.minGapMs,
        })),
      weather: weatherRows[0]
        ? {
          minuteOffsets: weatherRows[0].minuteOffsets,
          airTempC: weatherRows[0].airTempTenths.map((t) => t / 10),
          trackTempC: weatherRows[0].trackTempTenths.map((t) => t / 10),
          rainfall: weatherRows[0].rainfall,
        }
        : null,
    };
  }
}
