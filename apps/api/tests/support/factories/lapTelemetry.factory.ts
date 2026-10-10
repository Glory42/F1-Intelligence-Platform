import type { Db } from '../../../src/config/database';
import { qualifyingLapTelemetry } from '../../../src/db/schema';

type TelemetryInsert = typeof qualifyingLapTelemetry.$inferInsert;

export const squareLap = {
  distanceM: [0, 10, 20, 30], timeMs: [0, 300, 600, 900], speed: [300, 310, 320, 330],
  throttle: [100, 100, 100, 100], brake: [0, 0, 0, 0], gear: [8, 8, 8, 8], x: [0, 10, 10, 0], y: [0, 0, 10, 10],
};

export async function createLapTelemetry(db: Db, raceId: number, driverId: number, overrides: Partial<TelemetryInsert> = {}) {
  const [row] = await db
    .insert(qualifyingLapTelemetry)
    .values({ raceId, driverId, sessionType: 'Q', lapNumber: 10, lapTimeMs: 80000, samples: squareLap, ...overrides })
    .returning();
  return row;
}
