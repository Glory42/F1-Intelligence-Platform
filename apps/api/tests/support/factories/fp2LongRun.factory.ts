import type { Db } from '../../../src/config/database';
import { fp2LongRunTimes } from '../../../src/db/schema';

type Fp2LongRunInsert = typeof fp2LongRunTimes.$inferInsert;

export async function createFp2LongRun(
  db: Db,
  raceId: number,
  driverId: number,
  overrides: Partial<Fp2LongRunInsert> = {}
) {
  const [row] = await db
    .insert(fp2LongRunTimes)
    .values({ raceId, driverId, compound: 'MEDIUM', sessionType: 'FP2', medianLapMs: 84000, stintLength: 8, ...overrides })
    .returning();
  return row;
}
