import { and, asc, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../../config/database';
import { drivers, fp2LongRunTimes, teams } from '../../db/schema';
import type { FridayPaceRow } from '../../common/types';
import { toDriver } from '../../common/mappers';

export class FridayPaceService {
  // The Long Run Pace feature's raw input: each driver's quickest practice long run.
  async findFridayPace(db: Db, raceId: number): Promise<FridayPaceRow[]> {
    const rows = await db
      .select({ run: fp2LongRunTimes, driver: drivers, team: teams })
      .from(fp2LongRunTimes)
      .innerJoin(drivers, eq(fp2LongRunTimes.driverId, drivers.id))
      .innerJoin(teams, eq(drivers.teamId, teams.id))
      .where(and(eq(fp2LongRunTimes.raceId, raceId), isNotNull(fp2LongRunTimes.medianLapMs)))
      .orderBy(asc(fp2LongRunTimes.medianLapMs));

    const best = new Map<number, (typeof rows)[number]>();
    for (const r of rows) if (!best.has(r.driver.id)) best.set(r.driver.id, r);
    const ranked = [...best.values()];
    const fastest = ranked[0]?.run.medianLapMs ?? 0;
    return ranked.map((r) => ({
      driver: toDriver(r.driver, r.team),
      compound: r.run.compound,
      sessionType: r.run.sessionType,
      medianLapMs: r.run.medianLapMs!,
      stintLength: r.run.stintLength,
      deltaToFastestMs: r.run.medianLapMs! - fastest,
    }));
  }
}
