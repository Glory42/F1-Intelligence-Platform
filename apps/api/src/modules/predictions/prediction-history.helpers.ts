import type { drivers, teams, races, circuits } from '../../db/schema';
import type { PredictionHistoryItem, Driver } from '../../common/types';
import { toDriver, toCircuit } from '../../common/mappers';

type DriverRow = typeof drivers.$inferSelect;
type TeamRow = typeof teams.$inferSelect;

// GP and sprint history rows are queried from different tables but reduce to the
// same shape once the prediction row is unwrapped for its computedAt timestamp.
export interface HistoryPredictionRow {
  race: typeof races.$inferSelect;
  circuit: typeof circuits.$inferSelect;
  driver: DriverRow;
  team: TeamRow;
  computedAt: Date;
}

export interface HistoryWinnerRow {
  raceId: number;
  driver: DriverRow;
  team: TeamRow;
}

export interface HistoryProbRow {
  raceId: number;
  driverId: number;
  winProbability: string;
  predictedPosition: number | null;
}

export function buildWinnerMap(rows: HistoryWinnerRow[]): Map<number, Driver> {
  const map = new Map<number, Driver>();
  for (const w of rows) map.set(w.raceId, toDriver(w.driver, w.team));
  return map;
}

export function buildProbPosMaps(rows: HistoryProbRow[]): {
  probMap: Map<string, string>;
  posMap: Map<string, number>;
} {
  const probMap = new Map<string, string>();
  const posMap = new Map<string, number>();
  for (const p of rows) {
    probMap.set(`${p.raceId}:${p.driverId}`, p.winProbability);
    if (p.predictedPosition != null) posMap.set(`${p.raceId}:${p.driverId}`, p.predictedPosition);
  }
  return { probMap, posMap };
}

export interface HistoryBuildContext {
  actualWinnerMap: Map<number, Driver>;
  probMap: Map<string, string>;
  posMap: Map<string, number>;
  isDone: (status: string) => boolean;
  isSprint: boolean;
}

export function buildHistoryItems(
  rows: HistoryPredictionRow[],
  ctx: HistoryBuildContext,
): PredictionHistoryItem[] {
  return rows.map((r) => {
    const predictedWinner = toDriver(r.driver, r.team);
    const done = ctx.isDone(r.race.status);
    const actualWinner = done ? (ctx.actualWinnerMap.get(r.race.id) ?? null) : null;
    const decided = done && actualWinner !== null;
    return {
      raceId: r.race.id,
      raceName: r.race.name,
      raceDate: r.race.raceDate,
      roundNumber: r.race.roundNumber,
      circuit: toCircuit(r.circuit),
      predictedWinner,
      actualWinner,
      winProbability: ctx.probMap.get(`${r.race.id}:${r.driver.id}`) ?? '0',
      correct: decided ? actualWinner.id === predictedWinner.id : null,
      actualWinnerPredictedPosition: decided
        ? (ctx.posMap.get(`${r.race.id}:${actualWinner.id}`) ?? null)
        : null,
      computedAt: r.computedAt.toISOString(),
      isSprint: ctx.isSprint,
    };
  });
}

export function mergeHistoryByDateDesc(
  ...groups: PredictionHistoryItem[][]
): PredictionHistoryItem[] {
  return groups
    .flat()
    .sort((a, b) => new Date(b.raceDate).getTime() - new Date(a.raceDate).getTime());
}
