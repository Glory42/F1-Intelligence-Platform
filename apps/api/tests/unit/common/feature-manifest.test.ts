import { describe, expect, test } from 'bun:test';
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
