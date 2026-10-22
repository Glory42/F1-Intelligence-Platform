import type { Db } from '../../../src/config/database';
import { driverPredictionFeatures } from '../../../src/db/schema';
import type { StoredGpFeatures } from '../../../src/common/types';

type FeaturesInsert = typeof driverPredictionFeatures.$inferInsert;

// One weighted-v4 feature row as data-engine writes it: every manifest feature, snake_case keys.
export function storedGpFeatures(overrides: StoredGpFeatures = {}): StoredGpFeatures {
  return {
    grid: { value: -0.69315, contribution: 0.42 },
    quali_pace: { value: -0.12, contribution: 0.3 },
    team_quali_pace: { value: -0.2, contribution: 0.25 },
    driver_points: { value: 18.5, contribution: 0.6 },
    teammate_edge: { value: 0.1, contribution: 0.05 },
    grid_processional: { value: -0.34657, contribution: 0.2 },
    team_race_pace: { value: -0.15, contribution: 0.35 },
    ...overrides,
  };
}

export async function createDriverPredictionFeatures(
  db: Db,
  raceId: number,
  driverId: number,
  overrides: Partial<FeaturesInsert> = {}
) {
  const [row] = await db
    .insert(driverPredictionFeatures)
    .values({
      raceId,
      driverId,
      features: storedGpFeatures(),
      rawWeightedScore: '2.170000',
      winProbability: '0.35000',
      predictedPosition: 1,
      ...overrides,
    })
    .returning();
  return row;
}
