import { eq } from 'drizzle-orm';
import type { Db } from '../config/database';
import { races } from '../db/schema';

export async function findRaceStatus(db: Db, raceId: number): Promise<string | null> {
  const rows = await db.select({ status: races.status }).from(races).where(eq(races.id, raceId)).limit(1);
  return rows[0]?.status ?? null;
}
