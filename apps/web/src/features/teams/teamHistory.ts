export interface TeamHistoryRow<S> {
  year: number;
  teamId: number | null;
  stats: S | null;
  chassis: string | null;
  engine: string | null;
}

// Our seasons start in 1980; F1DB's lineage goes back to a team's first entry, so either side can be missing a year.
export function mergeTeamHistory<S>(
  career: Array<{ year: number; teamId: number; stats: S | null }>,
  lineage: Array<{ year: number; chassis: string | null; engine: string | null }>,
): TeamHistoryRow<S>[] {
  const rows = new Map<number, TeamHistoryRow<S>>();
  for (const c of career) rows.set(c.year, { year: c.year, teamId: c.teamId, stats: c.stats, chassis: null, engine: null });
  for (const l of lineage) {
    const row = rows.get(l.year) ?? { year: l.year, teamId: null, stats: null, chassis: null, engine: null };
    rows.set(l.year, { ...row, chassis: l.chassis, engine: l.engine });
  }
  return [...rows.values()].sort((a, b) => b.year - a.year);
}
