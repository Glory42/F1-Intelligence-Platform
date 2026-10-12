import { describe, expect, test } from 'bun:test';
import featureWeights from '../../../../../docs/feature-weights.json';
import {
  GP_FEATURE_MANIFEST,
  SPRINT_FEATURE_MANIFEST,
  mapFeatureRow,
} from '../../../src/common/feature-manifest';
import type { FeatureManifestEntry } from '../../../src/common/feature-manifest';

type Row = Record<string, unknown>;

const manifest: FeatureManifestEntry<Row>[] = [
  { key: 'req', column: 'reqCol', label: 'Required', nullable: false },
  { key: 'opt', column: 'optCol', label: 'Optional', nullable: true },
];

describe('mapFeatureRow', () => {
  test('projects manifest keys from their mapped columns', () => {
    const out = mapFeatureRow<Row, Record<string, unknown>>(
      { reqCol: '0.5', optCol: '0.9', extra: 'ignored' },
      manifest,
    );
    expect(out).toEqual({ req: '0.5', opt: '0.9' });
  });

  test('coalesces a null nullable column to null', () => {
    const out = mapFeatureRow<Row, Record<string, unknown>>(
      { reqCol: '0.5', optCol: null },
      manifest,
    );
    expect(out.opt).toBeNull();
  });

  test('coalesces a missing nullable column to null', () => {
    const out = mapFeatureRow<Row, Record<string, unknown>>({ reqCol: '0.5' }, manifest);
    expect(out.opt).toBeNull();
  });

  test('passes a non-nullable column through without coalescing', () => {
    const out = mapFeatureRow<Row, Record<string, unknown>>(
      { reqCol: null, optCol: '0.9' },
      manifest,
    );
    expect(out.req).toBeNull();
  });

  const asGenericEntries = (
    entries: readonly { key: string; column: string | number | symbol; label: string; nullable: boolean }[],
  ): FeatureManifestEntry<Row>[] =>
    entries.map((e) => ({ key: e.key, column: e.column as string, label: e.label, nullable: e.nullable }));

  test('GP manifest yields exactly its 15 feature keys', () => {
    const raw: Row = {};
    for (const e of GP_FEATURE_MANIFEST) raw[e.column as string] = '0.5';
    const out = mapFeatureRow<Row, Record<string, unknown>>(raw, asGenericEntries(GP_FEATURE_MANIFEST));
    expect(Object.keys(out).sort()).toEqual(GP_FEATURE_MANIFEST.map((e) => e.key).sort());
  });

  test('sprint manifest yields exactly its 10 feature keys', () => {
    const raw: Row = {};
    for (const e of SPRINT_FEATURE_MANIFEST) raw[e.column as string] = '0.5';
    const out = mapFeatureRow<Row, Record<string, unknown>>(raw, asGenericEntries(SPRINT_FEATURE_MANIFEST));
    expect(Object.keys(out).sort()).toEqual(SPRINT_FEATURE_MANIFEST.map((e) => e.key).sort());
  });
});

// The shared fixture is snake_case (Python-native) and lists only the weighted features; the API
// manifest also maps unweighted columns (starting position, track overtake), which have no entry.
function labelsOf(manifest: readonly { key: string; label: string }[], model: Record<string, { label: string }>) {
  const byKey = new Map(manifest.map((e) => [e.key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), e.label]));
  return Object.fromEntries(Object.keys(model).map((key) => [key, byKey.get(key)]));
}

function fixtureLabels(model: Record<string, { label: string }>) {
  return Object.fromEntries(Object.entries(model).map(([key, { label }]) => [key, label]));
}

describe('docs/feature-weights.json (cross-language drift check)', () => {
  test('GP manifest labels match the shared fixture', () => {
    expect(labelsOf(GP_FEATURE_MANIFEST, featureWeights.gp)).toEqual(fixtureLabels(featureWeights.gp));
  });

  test('sprint manifest labels match the shared fixture', () => {
    expect(labelsOf(SPRINT_FEATURE_MANIFEST, featureWeights.sprint)).toEqual(fixtureLabels(featureWeights.sprint));
  });
});
