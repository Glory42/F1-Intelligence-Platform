import type { Db } from '../../../src/config/database';
import { lapTimes } from '../../../src/db/schema';

type LapTimeInsert = typeof lapTimes.$inferInsert;

export async function createLapTimes(db: Db, rows: LapTimeInsert[]) {
  return db.insert(lapTimes).values(rows).returning();
}

export function stintLaps(
  raceId: number,
  driverId: number,
  stintNumber: number,
  compound: string,
  laps: [first: number, last: number],
): LapTimeInsert[] {
  return Array.from({ length: laps[1] - laps[0] + 1 }, (_, i) => ({
    raceId, driverId, stintNumber, compound,
    lapNumber: laps[0] + i, lapTimeMs: 82000, tyreLife: i + 2, isPitLap: false,
  }));
}
