import type { Db } from '../../../src/config/database';
import { sprintLapTimes } from '../../../src/db/schema';

type SprintLapTimeInsert = typeof sprintLapTimes.$inferInsert;

export async function createSprintLapTimes(db: Db, rows: SprintLapTimeInsert[]) {
  return db.insert(sprintLapTimes).values(rows).returning();
}
