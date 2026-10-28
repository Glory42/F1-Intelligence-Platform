import type { driverSprintFeatures } from '../db/schema';
import type {
  FeatureInfo, FeatureTerm, GpFeatureKey, GpFeatures, SprintFeatureKey, SprintFeatures, StoredGpFeatures,
} from './types';

type SprintRow = typeof driverSprintFeatures.$inferSelect;

// One feature as a Prediction's page shows it. Labels, importances and order are checked against
// docs/feature-weights.json, the copy data-engine's fit and sprint manifest write and test.
interface ManifestEntry<TKey extends string> {
  key: TKey;
  label: string;
  shortLabel?: string;
  importance: number;
}

// weighted-v4: `name` is the key data-engine stores (gp_features_v4.GP_V4_FEATURES).
export const GP_FEATURE_MANIFEST: (ManifestEntry<GpFeatureKey> & { name: string })[] = [
  { key: 'grid', name: 'grid', label: 'Grid Slot', importance: 20 },
  { key: 'qualiPace', name: 'quali_pace', label: 'Qualifying Pace', shortLabel: 'Quali Pace', importance: 11 },
  { key: 'teamQualiPace', name: 'team_quali_pace', label: 'Team Qualifying Pace', shortLabel: 'Team Quali', importance: 12 },
  { key: 'driverPoints', name: 'driver_points', label: 'Driver Form', importance: 18 },
  { key: 'teammateEdge', name: 'teammate_edge', label: 'Teammate Edge', importance: 4 },
  { key: 'gridProcessional', name: 'grid_processional', label: 'Grid × Hard-to-Pass Track', shortLabel: 'Grid × Track', importance: 17 },
  { key: 'teamRacePace', name: 'team_race_pace', label: 'Team Race Pace', shortLabel: 'Race Pace', importance: 18 },
];

// sprint-v2: importance is the hand weight. `column: keyof SprintRow` makes a stale column a compile error.
export const SPRINT_FEATURE_MANIFEST: (ManifestEntry<SprintFeatureKey> & { column: keyof SprintRow })[] = [
  { key: 'carPerformance', column: 'carPerformanceScore', label: 'Car Performance', importance: 25 },
  { key: 'circuitAdjStartPos', column: 'circuitAdjStartPosScore', label: 'Circuit-Adj. Starting Position', shortLabel: 'Adj. Grid Pos', importance: 25 },
  { key: 'shortRunPace', column: 'shortRunPaceScore', label: 'Short Run Pace', importance: 10 },
  { key: 'driverRating', column: 'driverRatingScore', label: 'Driver Rating', importance: 10 },
  { key: 'weatherImpact', column: 'weatherImpactScore', label: 'Weather Impact', shortLabel: 'Weather', importance: 8 },
  { key: 'winRate', column: 'winRateScore', label: 'Win Rate', importance: 8 },
  { key: 'luckFactor', column: 'luckFactorScore', label: 'Luck Factor', importance: 8 },
  { key: 'sqQualifyingDelta', column: 'sqQualifyingDeltaScore', label: 'SQ vs Teammate', importance: 6 },
];

// sprint-v2 softmaxes its weighted score divided by this; weighted-v4's fitted weights carry their own scale.
export const SPRINT_SOFTMAX_TEMPERATURE = 0.3;

export function featureInfo<TKey extends string>(manifest: ManifestEntry<TKey>[]): FeatureInfo<TKey>[] {
  return manifest.map(({ key, label, shortLabel, importance }) => ({ key, label, shortLabel: shortLabel ?? label, importance }));
}

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

// sprint-v2's win probability is softmax(Σ weight × score / T), so each score's log-odds term is
// weight × score / T: the same {value, contribution} shape the GP model stores.
export function mapSprintFeatures(row: SprintRow): SprintFeatures {
  const out = {} as SprintFeatures;
  for (const { key, column, importance } of SPRINT_FEATURE_MANIFEST) {
    const value = Number(row[column] ?? 0);
    out[key] = { value, contribution: (importance / 100) * value / SPRINT_SOFTMAX_TEMPERATURE } satisfies FeatureTerm;
  }
  return out;
}
