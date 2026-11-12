import type { Db } from '../../../src/config/database';
import { preQualiPredictions } from '../../../src/db/schema';
import { storedGpFeatures } from './driverPredictionFeatures.factory';

type PreQualiInsert = typeof preQualiPredictions.$inferInsert;

export async function createPreQualiPrediction(
  db: Db,
  raceId: number,
  driverId: number,
  overrides: Partial<PreQualiInsert> = {}
) {
  const [row] = await db
    .insert(preQualiPredictions)
    .values({
      raceId,
      driverId,
      features: storedGpFeatures(),
      rawWeightedScore: '1.200000',
      winProbability: '0.30000',
      predictedPosition: 1,
      modelVersion: 'pre-quali-v1',
      ...overrides,
    })
    .returning();
  return row;
}
