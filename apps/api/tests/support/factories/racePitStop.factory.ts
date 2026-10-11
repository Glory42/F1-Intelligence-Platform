import type { Db } from '../../../src/config/database';
import { racePitStops } from '../../../src/db/schema';

type RacePitStopInsert = typeof racePitStops.$inferInsert;

export async function createRacePitStop(
  db: Db,
  raceId: number,
  driverId: number,
  overrides: Partial<RacePitStopInsert> = {}
) {
  const [row] = await db
    .insert(racePitStops)
    .values({ raceId, driverId, lapNumber: 20, pitLaneMs: 22000, stationaryMs: 2400, ...overrides })
    .returning();
  return row;
}
