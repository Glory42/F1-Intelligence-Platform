import type { Db } from '../../../src/config/database';
import { driverSprintFeatures } from '../../../src/db/schema';
import { storedGpFeatures } from './driverPredictionFeatures.factory';

type SprintFeaturesInsert = typeof driverSprintFeatures.$inferInsert;

// One sprint-v3 row as data-engine writes it: weighted-v4's features scored on the sprint grid.
export async function createDriverSprintFeatures(
  db: Db,
  raceId: number,
  driverId: number,
  overrides: Partial<SprintFeaturesInsert> = {}
) {
  const [row] = await db
    .insert(driverSprintFeatures)
    .values({
      raceId,
      driverId,
      features: storedGpFeatures(),
      rawWeightedScore: '2.170000',
      winProbability: '0.40000',
      predictedPosition: 1,
      ...overrides,
    })
    .returning();
  return row;
}
