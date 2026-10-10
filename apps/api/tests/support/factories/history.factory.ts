import type { Db } from '../../../src/config/database';
import { historyConstructorSeasons, historyConstructors, historyDrivers } from '../../../src/db/schema';

export async function createHistoryDriver(db: Db, overrides: Partial<typeof historyDrivers.$inferInsert> & { f1dbId: string; name: string }) {
  const [row] = await db
    .insert(historyDrivers)
    .values({ matchKey: overrides.name.toLowerCase(), ...overrides })
    .returning();
  return row;
}

export async function createHistoryConstructor(db: Db, overrides: Partial<typeof historyConstructors.$inferInsert> & { f1dbId: string; name: string }) {
  const [row] = await db.insert(historyConstructors).values(overrides).returning();
  return row;
}

export async function createHistoryConstructorSeason(db: Db, constructorF1dbId: string, year: number, chassis: string, engine: string) {
  const [row] = await db.insert(historyConstructorSeasons).values({ constructorF1dbId, year, chassis, engine }).returning();
  return row;
}
