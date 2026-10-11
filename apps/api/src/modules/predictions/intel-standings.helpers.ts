import type { drivers, teams, driverPredictionFeatures } from '../../db/schema';
import type { FeatureScores, IntelStandingRow } from '../../common/types';
import { toDriver } from '../../common/mappers';
import { GP_FEATURE_MANIFEST } from '../../common/feature-manifest';

export interface SprintSeasonTotals {
  sprintWins: number;
  sprintPodiums: number;
  sprintTotalPoints: string;
}

// A new feature column is a GP_FEATURE_MANIFEST entry, not a copy-pasted `if` line here.
const FEATURE_COLUMNS = GP_FEATURE_MANIFEST;

export interface SeasonFeatureRow {
  driver_prediction_features: typeof driverPredictionFeatures.$inferSelect;
  drivers: typeof drivers.$inferSelect;
  teams: typeof teams.$inferSelect;
}

export interface AggregatedFeatures {
  driver: ReturnType<typeof toDriver>;
  features: FeatureScores;
  rawWeightedScore: string;
  winProbability: string;
  avgRaw: number;
}

const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

function emptyColumnArrays(): Record<keyof FeatureScores, number[]> {
  const out = {} as Record<keyof FeatureScores, number[]>;
  for (const c of FEATURE_COLUMNS) out[c.key] = [];
  return out;
}

// Averages every feature score for a driver across all their GP feature rows in a
// season, keyed by driver code so cross-team moves collapse into one row.
export function aggregateSeasonFeatures(rows: SeasonFeatureRow[]): AggregatedFeatures[] {
  type Bucket = {
    driver: ReturnType<typeof toDriver>;
    raw: number[];
    winProb: number[];
    cols: Record<keyof FeatureScores, number[]>;
  };
  const byCode = new Map<string, Bucket>();

  for (const row of rows) {
    const f = row.driver_prediction_features;
    let bucket = byCode.get(row.drivers.code);
    if (!bucket) {
      bucket = { driver: toDriver(row.drivers, row.teams), raw: [], winProb: [], cols: emptyColumnArrays() };
      byCode.set(row.drivers.code, bucket);
    }
    bucket.driver = toDriver(row.drivers, row.teams);
    bucket.raw.push(Number(f.rawWeightedScore));
    bucket.winProb.push(Number(f.winProbability));
    for (const c of FEATURE_COLUMNS) {
      const value = f[c.column];
      if (c.nullable && value == null) continue;
      bucket.cols[c.key].push(Number(value));
    }
  }

  return Array.from(byCode.values()).map((bucket) => {
    const features = {} as Record<keyof FeatureScores, string | null>;
    for (const c of FEATURE_COLUMNS) {
      const arr = bucket.cols[c.key];
      features[c.key] = c.nullable ? (arr.length ? String(avg(arr)) : null) : String(avg(arr));
    }

    return {
      driver: bucket.driver,
      features: features as FeatureScores,
      rawWeightedScore: String(avg(bucket.raw)),
      winProbability: String(avg(bucket.winProb)),
      avgRaw: avg(bucket.raw),
    };
  });
}

// Ranks drivers by their averaged weighted score, min-max normalises it to a
// 0-100 headline number, and folds in each driver's season sprint totals.
export function buildIntelStandingRows(
  aggregated: AggregatedFeatures[],
  sprintTotals: Map<number, SprintSeasonTotals>,
): IntelStandingRow[] {
  const ranked = [...aggregated].sort((a, b) => b.avgRaw - a.avgRaw);
  const rawVals = ranked.map((r) => r.avgRaw);
  const minScore = Math.min(...rawVals);
  const range = Math.max(...rawVals) - minScore || 1;

  return ranked.map((r) => {
    const sprint = sprintTotals.get(r.driver.id);
    return {
      driver: r.driver,
      features: r.features,
      rawWeightedScore: r.rawWeightedScore,
      winProbability: r.winProbability,
      predictedPosition: null,
      overallScore: Math.round(((r.avgRaw - minScore) / range) * 100),
      sprintWins: sprint?.sprintWins ?? 0,
      sprintPodiums: sprint?.sprintPodiums ?? 0,
      sprintTotalPoints: sprint?.sprintTotalPoints ?? '0',
    };
  });
}
