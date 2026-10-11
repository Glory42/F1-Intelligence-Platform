import type { Db } from '../../../src/config/database';
import { raceBattles, raceLapTraces, raceWeatherTraces } from '../../../src/db/schema';

type TraceInsert = typeof raceLapTraces.$inferInsert;
type BattleInsert = typeof raceBattles.$inferInsert;

export async function createLapTrace(db: Db, raceId: number, driverId: number, overrides: Partial<TraceInsert> = {}) {
  const [row] = await db
    .insert(raceLapTraces)
    .values({ raceId, driverId, positions: [1], gapsMs: [0], intervalsMs: [null], lapsDown: [0], ...overrides })
    .returning();
  return row;
}

export async function createBattle(
  db: Db, raceId: number, chaserDriverId: number, leaderDriverId: number, overrides: Partial<BattleInsert> = {}
) {
  const [row] = await db
    .insert(raceBattles)
    .values({ raceId, chaserDriverId, leaderDriverId, lapStart: 1, lapEnd: 3, minGapMs: 500, ...overrides })
    .returning();
  return row;
}

export async function createWeatherTrace(db: Db, raceId: number, overrides: Partial<typeof raceWeatherTraces.$inferInsert> = {}) {
  const [row] = await db
    .insert(raceWeatherTraces)
    .values({ raceId, minuteOffsets: [0], airTempTenths: [250], trackTempTenths: [400], rainfall: [false], ...overrides })
    .returning();
  return row;
}
