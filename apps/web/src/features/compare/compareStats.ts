export const DEFAULT_COMPARE_YEAR = 2026;

export interface CareerTotals {
  entries: number;
  wins: number;
  podiums: number;
  poles: number;
  points: number;
  dnfs: number;
  bestFin: number | null;
}

interface CareerStatsLike {
  wins: number;
  podiums: number;
  championshipPoints: string;
  dnfCount: number;
  championshipPosition: number | null;
}

// Sums a per-year career stats array into totals. `getEntries`/`getPoles` extract the
// fields that differ between driver stats (racesEntered/poles) and team stats (racesCompleted, no poles).
export function aggregateCareerStats<S extends CareerStatsLike>(
  career: { stats: S | null }[] | null,
  getEntries: (stats: S) => number,
  getPoles: (stats: S) => number = () => 0
): CareerTotals | null {
  if (!career) return null;
  return career.reduce<CareerTotals>((acc, curr) => {
    if (!curr.stats) return acc;
    acc.entries += getEntries(curr.stats);
    acc.wins += curr.stats.wins;
    acc.podiums += curr.stats.podiums;
    acc.poles += getPoles(curr.stats);
    acc.points += Number(curr.stats.championshipPoints);
    acc.dnfs += curr.stats.dnfCount;
    if (curr.stats.championshipPosition) {
      acc.bestFin = acc.bestFin ? Math.min(acc.bestFin, curr.stats.championshipPosition) : curr.stats.championshipPosition;
    }
    return acc;
  }, { entries: 0, wins: 0, podiums: 0, poles: 0, points: 0, dnfs: 0, bestFin: null });
}
