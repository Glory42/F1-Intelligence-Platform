import type { Db } from '../../../src/config/database';
import { sprintPredictions } from '../../../src/db/schema';

type SprintPredictionInsert = typeof sprintPredictions.$inferInsert;

export async function createSprintPrediction(
  db: Db,
  raceId: number,
  predictedWinnerId: number,
  overrides: Partial<SprintPredictionInsert> = {}
) {
  const [row] = await db
    .insert(sprintPredictions)
    .values({
      raceId,
      predictedWinnerId,
      modelVersion: 'sprint-v3',
      ...overrides,
    })
    .returning();
  return row;
}
