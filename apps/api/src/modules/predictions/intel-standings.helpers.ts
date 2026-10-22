import type { drivers, teams, driverPredictionFeatures } from '../../db/schema';
import type { IntelStandingRow } from '../../common/types';
import { toDriver } from '../../common/mappers';
import { personKey } from '../../common/identity';
import { championshipPoints } from '../../common/standings';

export interface SeasonTotals {
  sprintWins: number;
  sprintPodiums: number;
  sprintTotalPoints: string;
  totalPoints: string;
}

export interface SeasonFeatureRow {
  driver_prediction_features: typeof driverPredictionFeatures.$inferSelect;
  drivers: typeof drivers.$inferSelect;
  teams: typeof teams.$inferSelect;
}

export interface AggregatedScores {
  driver: ReturnType<typeof toDriver>;
  rawWeightedScore: string;
  winProbability: string;
  avgRaw: number;
}

const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

// Averages a driver's model score and win probability across all their GP feature rows in a
// season, keyed by person (codes repeat within some seasons) so a team move collapses into one row.
export function aggregateSeasonScores(rows: SeasonFeatureRow[]): AggregatedScores[] {
  type Bucket = {
    driver: ReturnType<typeof toDriver>;
    raw: number[];
    winProb: number[];
  };
  const byPerson = new Map<string, Bucket>();

  for (const row of rows) {
    const f = row.driver_prediction_features;
    let bucket = byPerson.get(personKey(row.drivers));
    if (!bucket) {
      bucket = { driver: toDriver(row.drivers, row.teams), raw: [], winProb: [] };
      byPerson.set(personKey(row.drivers), bucket);
    }
    bucket.driver = toDriver(row.drivers, row.teams);
    bucket.raw.push(Number(f.rawWeightedScore));
    bucket.winProb.push(Number(f.winProbability));
  }

  return Array.from(byPerson.values()).map((bucket) => ({
    driver: bucket.driver,
    rawWeightedScore: String(avg(bucket.raw)),
    winProbability: String(avg(bucket.winProb)),
    avgRaw: avg(bucket.raw),
  }));
}

// Ranks drivers by their averaged weighted score, min-max normalises it to a
// 0-100 headline number, and folds in each driver's season sprint and championship totals.
export function buildIntelStandingRows(
  aggregated: AggregatedScores[],
  seasonTotals: Map<number, SeasonTotals>,
): IntelStandingRow[] {
  const ranked = [...aggregated].sort((a, b) => b.avgRaw - a.avgRaw);
  const rawVals = ranked.map((r) => r.avgRaw);
  const minScore = Math.min(...rawVals);
  const range = Math.max(...rawVals) - minScore || 1;

  return ranked.map((r) => {
    const totals = seasonTotals.get(r.driver.id);
    return {
      driver: r.driver,
      rawWeightedScore: r.rawWeightedScore,
      winProbability: r.winProbability,
      predictedPosition: null,
      overallScore: Math.round(((r.avgRaw - minScore) / range) * 100),
      sprintWins: totals?.sprintWins ?? 0,
      sprintPodiums: totals?.sprintPodiums ?? 0,
      sprintTotalPoints: totals?.sprintTotalPoints ?? '0',
      championshipPoints: totals ? championshipPoints(totals.totalPoints, totals.sprintTotalPoints) : '0',
    };
  });
}
