import type { Db } from '../../../src/config/database';
import { racePredictions } from '../../../src/db/schema';

type RacePredictionInsert = typeof racePredictions.$inferInsert;

export async function createRacePrediction(
  db: Db,
  raceId: number,
  predictedWinnerId: number,
  overrides: Partial<RacePredictionInsert> = {}
) {
  const [row] = await db
    .insert(racePredictions)
    .values({
      raceId,
      predictedWinnerId,
      modelVersion: 'weighted-v4',
      ...overrides,
    })
    .returning();
  return row;
}
