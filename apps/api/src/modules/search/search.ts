import { Hono } from 'hono';
import { desc, eq } from 'drizzle-orm';
import type { Bindings, Driver } from '../../common/types';
import { createDb, type Db } from '../../config/database';
import { drivers, teams, circuits, seasons } from '../../db/schema';
import { toDriver, toTeam, toCircuit } from '../../common/mappers';
import { CACHE_REFERENCE } from '../../common/cache';
import { isSamePerson, personKey } from '../../common/identity';

type DriverRow = typeof drivers.$inferSelect;

// Rows arrive newest season first, so the first row kept for a person is their latest season.
function latestRowPerPerson<T extends { driver: DriverRow }>(rows: T[]): T[] {
  const kept: T[] = [];
  const keys = new Set<string>();
  const byCode = new Map<string, DriverRow[]>();
  for (const row of rows) {
    const key = personKey(row.driver);
    const sameCode = byCode.get(row.driver.code) ?? [];
    if (keys.has(key) || sameCode.some((d) => isSamePerson(d, row.driver))) continue;
    kept.push(row);
    keys.add(key);
    byCode.set(row.driver.code, [...sameCode, row.driver]);
  }
  return kept;
}

async function getGlobalSearchData(db: Db) {

  const [teamRows, driverRows, allCircuits] = await Promise.all([
    db
      .selectDistinctOn([teams.teamKey], { team: teams })
      .from(teams)
      .innerJoin(seasons, eq(teams.seasonId, seasons.id))
      .orderBy(teams.teamKey, desc(seasons.year)),
    db
      .select({ driver: drivers, team: teams })
      .from(drivers)
      .innerJoin(seasons, eq(drivers.seasonId, seasons.id))
      .innerJoin(teams, eq(drivers.teamId, teams.id))
      .orderBy(desc(seasons.year)),
    db.select().from(circuits),
  ]);

  const mappedDrivers: Driver[] = latestRowPerPerson(driverRows).map(({ driver: d, team: t }) => toDriver(d, t));

  return {
    drivers: mappedDrivers,
    teams: teamRows.map((r) => r.team).map(toTeam),
    circuits: allCircuits.map(toCircuit),
  };
}

const searchModule = new Hono<{ Bindings: Bindings }>();

searchModule.get('/', async (c) => {
  const data = await getGlobalSearchData(createDb(c.env.DATABASE_URL));
  c.header('Cache-Control', CACHE_REFERENCE);
  return c.json({ data, error: null });
});

export default searchModule;
