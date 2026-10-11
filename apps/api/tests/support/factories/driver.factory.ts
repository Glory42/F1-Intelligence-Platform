import type { Db } from '../../../src/config/database';
import { drivers } from '../../../src/db/schema';

type DriverInsert = typeof drivers.$inferInsert;

// drivers is unique per (season, first name, last name), so each default driver is its own person.
let sequence = 0;

export async function createDriver(
  db: Db,
  seasonId: number,
  teamId: number,
  overrides: Partial<DriverInsert> = {}
) {
  const [row] = await db
    .insert(drivers)
    .values({
      seasonId,
      teamId,
      driverNumber: 1,
      code: 'TST',
      firstName: 'Test',
      lastName: `Driver ${++sequence}`,
      nationality: 'Testland',
      headshotUrl: null,
      ...overrides,
    })
    .returning();
  return row;
}
