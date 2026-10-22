import type { driverSprintFeatures } from '../db/schema';
import type { GpFeatureKey, GpFeatures, SprintFeatureScores, StoredGpFeatures } from './types';

// apps/api never computes with weights, so no weight field here: just the key/column/label
// mapping. `column: keyof TRow` makes a stale column reference a compile error.
export interface FeatureManifestEntry<TRow, TKey extends string = string> {
  key: TKey;
  column: keyof TRow;
  label: string;
  nullable: boolean;
}

// weighted-v4's features: `name` is the key data-engine stores (gp_features_v4.GP_V4_FEATURES).
// Labels and order are checked against docs/feature-weights.json.
export const GP_FEATURE_MANIFEST: { key: GpFeatureKey; name: string; label: string }[] = [
  { key: 'grid', name: 'grid', label: 'Grid Slot' },
  { key: 'qualiPace', name: 'quali_pace', label: 'Qualifying Pace' },
  { key: 'teamQualiPace', name: 'team_quali_pace', label: 'Team Qualifying Pace' },
  { key: 'driverPoints', name: 'driver_points', label: 'Driver Form' },
  { key: 'teammateEdge', name: 'teammate_edge', label: 'Teammate Edge' },
  { key: 'gridProcessional', name: 'grid_processional', label: 'Grid × Hard-to-Pass Track' },
  { key: 'teamRacePace', name: 'team_race_pace', label: 'Team Race Pace' },
];

// A row missing a feature was written by a different model than this manifest describes: failing
// beats showing that feature as a silent zero.
export function mapGpFeatures(stored: StoredGpFeatures): GpFeatures {
  const out = {} as GpFeatures;
  for (const { key, name } of GP_FEATURE_MANIFEST) {
    const term = stored[name];
    if (!term) throw new Error(`GP feature row has no "${name}": it was not written by weighted-v4`);
    out[key] = { value: term.value, contribution: term.contribution };
  }
  return out;
}

export const SPRINT_FEATURE_MANIFEST: FeatureManifestEntry<typeof driverSprintFeatures.$inferSelect, keyof SprintFeatureScores>[] = [
  { key: 'carPerformance', column: 'carPerformanceScore', label: 'Car Performance', nullable: false },
  { key: 'startingPosition', column: 'startingPositionScore', label: 'Starting Position', nullable: false },
  { key: 'driverRating', column: 'driverRatingScore', label: 'Driver Rating', nullable: false },
  { key: 'trackOvertake', column: 'trackOvertakeScore', label: 'Track Overtake', nullable: true },
  { key: 'shortRunPace', column: 'shortRunPaceScore', label: 'Short Run Pace', nullable: false },
  { key: 'circuitAdjStartPos', column: 'circuitAdjStartPosScore', label: 'Circuit-Adj. Starting Position', nullable: true },
  { key: 'sqQualifyingDelta', column: 'sqQualifyingDeltaScore', label: 'SQ vs Teammate', nullable: true },
  { key: 'weatherImpact', column: 'weatherImpactScore', label: 'Weather Impact', nullable: false },
  { key: 'winRate', column: 'winRateScore', label: 'Win Rate', nullable: false },
  { key: 'luckFactor', column: 'luckFactorScore', label: 'Luck Factor', nullable: false },
];

export function mapFeatureRow<TRow extends Record<string, unknown>, TOut>(
  raw: TRow,
  manifest: FeatureManifestEntry<TRow>[],
): TOut {
  const out: Record<string, unknown> = {};
  for (const { key, column, nullable } of manifest) {
    out[key] = nullable ? (raw[column] ?? null) : raw[column];
  }
  return out as TOut;
}
