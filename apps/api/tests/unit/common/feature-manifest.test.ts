import { describe, expect, test } from 'bun:test';
import featureWeights from '../../../../../docs/feature-weights.json';
import { GP_FEATURE_MANIFEST, featureInfo, mapGpFeatures } from '../../../src/common/feature-manifest';
import { storedGpFeatures } from '../../support/factories/driverPredictionFeatures.factory';

describe('mapGpFeatures', () => {
  test('renames the stored snake_case features to the API keys, value and contribution intact', () => {
    const out = mapGpFeatures(storedGpFeatures({ quali_pace: { value: -0.25, contribution: 0.1 } }));

    expect(Object.keys(out)).toEqual(GP_FEATURE_MANIFEST.map((e) => e.key));
    expect(out.qualiPace).toEqual({ value: -0.25, contribution: 0.1 });
  });

  test('a row missing a manifest feature fails instead of reading as zero', () => {
    const { team_race_pace: _dropped, ...partial } = storedGpFeatures();

    expect(() => mapGpFeatures(partial)).toThrow('team_race_pace');
  });
});

describe('featureInfo', () => {
  test('falls back to the full label where no short one is set', () => {
    const [grid, quali] = featureInfo(GP_FEATURE_MANIFEST);

    expect(grid).toEqual({ key: 'grid', label: 'Grid Slot', shortLabel: 'Grid Slot', importance: 20 });
    expect(quali.shortLabel).toBe('Quali Pace');
  });
});

describe('docs/feature-weights.json (cross-language drift check)', () => {
  test('GP manifest names, order, labels and importances match the shared fixture', () => {
    expect(GP_FEATURE_MANIFEST.map((e) => [e.name, e.label, e.importance])).toEqual(
      Object.entries(featureWeights.gp).map(([name, { label, importance }]) => [name, label, importance]),
    );
  });
});
