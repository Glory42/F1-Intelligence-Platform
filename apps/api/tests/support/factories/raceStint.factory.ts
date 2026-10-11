import type { Db } from '../../../src/config/database';
import { raceStints } from '../../../src/db/schema';

type RaceStintInsert = typeof raceStints.$inferInsert;

export async function createRaceStint(
  db: Db,
  raceId: number,
  driverId: number,
  overrides: Partial<RaceStintInsert> = {}
) {
  const [row] = await db
    .insert(raceStints)
    .values({ raceId, driverId, stintNumber: 1, compound: 'MEDIUM', lapStart: 1, lapEnd: 20, tyreAgeAtStart: 0, ...overrides })
    .returning();
  return row;
}
