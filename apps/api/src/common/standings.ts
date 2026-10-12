import { eq } from 'drizzle-orm';
import type { Db } from '../config/database';
import { seasons } from '../db/schema';

export type Season = typeof seasons.$inferSelect;

export async function resolveSeason(db: Db, year: number): Promise<Season | null> {
  const rows = await db.select().from(seasons).where(eq(seasons.year, year)).limit(1);
  return rows[0] ?? null;
}

type ChampionshipStats = {
  championshipPosition: number | null;
  championshipPoints: string;
};

// GP and sprint points are stored apart (numeric(6,1) each); the championship counts both. Kept
// in the same one-decimal string form as the stored totals.
export function championshipPoints(totalPoints: string, sprintTotalPoints: string): string {
  return (Number(totalPoints) + Number(sprintTotalPoints)).toFixed(1);
}

export function sortByChampionshipStanding<T extends { stats: ChampionshipStats }>(a: T, b: T): number {
  const posA = a.stats.championshipPosition ?? 999;
  const posB = b.stats.championshipPosition ?? 999;
  if (posA !== posB) return posA - posB;
  return Number(b.stats.championshipPoints) - Number(a.stats.championshipPoints);
}

// The domain-constant half of a standings/career aggregation: how to key an entity
// and its stats row, how to map a row to stats, and the sentinel for "no row". The
// per-endpoint output shape stays a separate `toOutput` arg: it varies by route.
export type StatsAdapter<Entity, StatsRow, Stats> = {
  entityId: (entity: Entity) => number;
  statsEntityId: (statsRow: StatsRow) => number;
  toStats: (statsRow: StatsRow) => Stats;
  emptyStats: Stats;
};

export function buildStandings<Entity, StatsRow, Stats extends ChampionshipStats, Out extends { stats: Stats }>(
  entityRows: Entity[],
  statsRows: StatsRow[],
  adapter: StatsAdapter<Entity, StatsRow, Stats>,
  toOutput: (entity: Entity, stats: Stats) => Out
): Out[] {
  const statsById = new Map(statsRows.map((row) => [adapter.statsEntityId(row), row]));
  const result = entityRows.map((entity) => {
    const statsRow = statsById.get(adapter.entityId(entity));
    return toOutput(entity, statsRow ? adapter.toStats(statsRow) : adapter.emptyStats);
  });
  return result.sort(sortByChampionshipStanding);
}

export function buildCareerStats<Entry, StatsRow, Stats, Out>(
  entries: Entry[],
  statsRows: StatsRow[],
  adapter: StatsAdapter<Entry, StatsRow, Stats>,
  toOutput: (entry: Entry, stats: Stats | null) => Out
): Out[] {
  const statsById = new Map(statsRows.map((row) => [adapter.statsEntityId(row), row]));
  return entries.map((entry) => {
    const statsRow = statsById.get(adapter.entityId(entry));
    return toOutput(entry, statsRow ? adapter.toStats(statsRow) : null);
  });
}
