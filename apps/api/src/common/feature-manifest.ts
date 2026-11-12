import type { FeatureInfo, GpFeatureKey, GpFeatures, StoredGpFeatures } from './types';

// One feature as a Prediction's page shows it. Labels, importances and order are checked against
// docs/feature-weights.json, the copy data-engine's fit writes and tests.
interface ManifestEntry<TKey extends string> {
  key: TKey;
  label: string;
  shortLabel?: string;
  importance: number;
}

// weighted-v4, and sprint-v3 (the same weights on the sprint grid): `name` is the key data-engine stores
// (gp_features_v4.GP_V4_FEATURES).
export const GP_FEATURE_MANIFEST: (ManifestEntry<GpFeatureKey> & { name: string })[] = [
  { key: 'grid', name: 'grid', label: 'Grid Slot', importance: 20 },
  { key: 'qualiPace', name: 'quali_pace', label: 'Qualifying Pace', shortLabel: 'Quali Pace', importance: 11 },
  { key: 'teamQualiPace', name: 'team_quali_pace', label: 'Team Qualifying Pace', shortLabel: 'Team Quali', importance: 12 },
  { key: 'driverPoints', name: 'driver_points', label: 'Driver Form', importance: 18 },
  { key: 'teammateEdge', name: 'teammate_edge', label: 'Teammate Edge', importance: 4 },
  { key: 'gridProcessional', name: 'grid_processional', label: 'Grid × Hard-to-Pass Track', shortLabel: 'Grid × Track', importance: 17 },
  { key: 'teamRacePace', name: 'team_race_pace', label: 'Team Race Pace', shortLabel: 'Race Pace', importance: 18 },
];

export function featureInfo<TKey extends string>(manifest: ManifestEntry<TKey>[]): FeatureInfo<TKey>[] {
  return manifest.map(({ key, label, shortLabel, importance }) => ({ key, label, shortLabel: shortLabel ?? label, importance }));
}

// A row missing a feature was written by a different model than this manifest describes: failing
// beats showing that feature as a silent zero.
export function mapGpFeatures(stored: StoredGpFeatures): GpFeatures {
  const out = {} as GpFeatures;
  for (const { key, name } of GP_FEATURE_MANIFEST) {
    const term = stored[name];
    if (!term) throw new Error(`Feature row has no "${name}": it was not written by weighted-v4 or sprint-v3`);
    out[key] = { value: term.value, contribution: term.contribution };
  }
  return out;
}
