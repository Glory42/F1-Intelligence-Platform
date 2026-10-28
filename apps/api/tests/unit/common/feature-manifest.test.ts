import { describe, expect, test } from 'bun:test';
import featureWeights from '../../../../../docs/feature-weights.json';
import {
  GP_FEATURE_MANIFEST,
  SPRINT_FEATURE_MANIFEST,
  SPRINT_SOFTMAX_TEMPERATURE,
  featureInfo,
  mapGpFeatures,
  mapSprintFeatures,
} from '../../../src/common/feature-manifest';
import { storedGpFeatures } from '../../support/factories/driverPredictionFeatures.factory';
import type { driverSprintFeatures } from '../../../src/db/schema';

type SprintRow = typeof driverSprintFeatures.$inferSelect;

function sprintRow(scores: Partial<SprintRow> = {}): SprintRow {
  const row: Record<string, unknown> = {};
  for (const { column } of SPRINT_FEATURE_MANIFEST) row[column] = '0.50000';
  return { ...row, ...scores } as SprintRow;
}

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

describe('mapSprintFeatures', () => {
  test('serves each score in the GP shape: the score, and weight × score / T as its log-odds term', () => {
    const out = mapSprintFeatures(sprintRow({ carPerformanceScore: '0.90000' }));

    expect(Object.keys(out)).toEqual(SPRINT_FEATURE_MANIFEST.map((e) => e.key));
    expect(out.carPerformance.value).toBe(0.9);
    expect(out.carPerformance.contribution).toBeCloseTo((0.25 * 0.9) / 0.3, 10);
  });

  test('the summed contributions softmax to sprint-v2’s own probabilities', () => {
    const a = mapSprintFeatures(sprintRow({ carPerformanceScore: '0.90000', shortRunPaceScore: '0.20000' }));
    const b = mapSprintFeatures(sprintRow({ carPerformanceScore: '0.40000', shortRunPaceScore: '0.80000' }));
    const sum = (f: typeof a) => Object.values(f).reduce((s, t) => s + t.contribution, 0);
    const weighted = (car: number, pace: number) => 0.25 * car + 0.1 * pace + 0.65 * 0.5;

    expect(sum(a) - sum(b)).toBeCloseTo((weighted(0.9, 0.2) - weighted(0.4, 0.8)) / SPRINT_SOFTMAX_TEMPERATURE, 10);
  });

  test('an older row with no SQ score reads as zero rather than failing', () => {
    expect(mapSprintFeatures(sprintRow({ sqQualifyingDeltaScore: null })).sqQualifyingDelta).toEqual({
      value: 0,
      contribution: 0,
    });
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

  test('sprint manifest keys, order, labels and weights match the shared fixture', () => {
    const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    expect(SPRINT_FEATURE_MANIFEST.map((e) => [snake(e.key), e.label, e.importance])).toEqual(
      Object.entries(featureWeights.sprint).map(([name, { label, weight }]) => [name, label, weight]),
    );
  });

  test('the sprint softmax temperature matches the shared fixture', () => {
    expect(SPRINT_SOFTMAX_TEMPERATURE).toBe(featureWeights.sprint_softmax_temperature);
  });
});
