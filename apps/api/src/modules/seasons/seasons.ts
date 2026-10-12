import { Hono } from 'hono';
import { desc, count, eq } from 'drizzle-orm';
import type { Bindings } from '../../common/types';
import { createDb, type Db } from '../../config/database';
import { seasons, races } from '../../db/schema';
import { CACHE_REFERENCE } from '../../common/cache';

async function findAllSeasons(db: Db): Promise<{ year: number; raceCount: number }[]> {
  const rows = await db
    .select({ year: seasons.year, raceCount: count(races.id) })
    .from(seasons)
    .leftJoin(races, eq(races.seasonId, seasons.id))
    .groupBy(seasons.year)
    .orderBy(desc(seasons.year));

  return rows.map((r) => ({ year: r.year, raceCount: r.raceCount }));
}

const seasonsModule = new Hono<{ Bindings: Bindings }>();

seasonsModule.get('/', async (c) => {
  const data = await findAllSeasons(createDb(c.env.DATABASE_URL));
  c.header('Cache-Control', CACHE_REFERENCE);
  return c.json({ data, error: null });
});

export default seasonsModule;
