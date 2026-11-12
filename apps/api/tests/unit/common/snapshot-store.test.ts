import { beforeEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { CACHE_ACTIVE, CACHE_COMPLETED, CACHE_QUIET } from '../../../src/common/cache';
import { readsQuery } from '../../../src/common/query-params';
import { snapshotStore } from '../../../src/common/snapshot-store';
import type { Bindings } from '../../../src/common/types';
import { FakeSnapshotBucket } from '../../support/cache/fake-snapshot-bucket';

const PRODUCTION: Bindings = { DATABASE_URL: '', ENVIRONMENT: 'production' };

function appWith(bucket: FakeSnapshotBucket | undefined, clock: () => number, answer: () => Response) {
  const app = new Hono<{ Bindings: Bindings }>();
  app.use('*', snapshotStore(() => bucket, clock));
  app.get('/data', readsQuery(['year'], () => answer()));
  app.onError((_, c) => c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'down' } }, 500));
  return app;
}

const answering = (version: string, cacheControl = CACHE_ACTIVE) => () =>
  Response.json({ data: version, error: null }, { headers: { 'Cache-Control': cacheControl } });

const failing = () => () => {
  throw new Error('Neon suspended');
};

const body = async (res: Response) => ((await res.json()) as { data: string | null }).data;

describe('snapshotStore', () => {
  let bucket: FakeSnapshotBucket;
  let now: number;
  const clock = () => now;
  const request = (answer: () => Response, path = '/data', env: Bindings = PRODUCTION) =>
    appWith(bucket, clock, answer).request(path, undefined, env);

  beforeEach(() => {
    bucket = new FakeSnapshotBucket();
    now = Date.parse('2026-06-20T12:00:00Z');
  });

  test('a repeat is answered from the bucket, marked as a snapshot hit', async () => {
    await request(answering('v1'));

    const res = await request(answering('v2'));

    expect(await body(res)).toBe('v1');
    expect(res.headers.get('x-snapshot')).toBe('hit');
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  test('a hit is never cached downstream for longer than the copy has left', async () => {
    await request(answering('v1'));
    now += 400_000;

    const res = await request(answering('v2'));

    expect(res.headers.get('Cache-Control')).toBe('public, max-age=200');
  });

  test('a completed answer keeps its own Cache-Control on a hit', async () => {
    now = Date.parse('2026-06-16T12:00:00Z');
    await request(answering('v1', CACHE_COMPLETED));
    now = Date.parse('2026-09-01T12:00:00Z');

    const res = await request(answering('v2', CACHE_COMPLETED));

    expect(await body(res)).toBe('v1');
    expect(res.headers.get('Cache-Control')).toBe(CACHE_COMPLETED);
  });

  test('a copy written between race weekends is held until the next write window opens', async () => {
    now = Date.parse('2026-06-16T12:00:00Z');
    await request(answering('v1', CACHE_QUIET));

    now = Date.parse('2026-06-17T05:59:00Z');
    const held = await request(answering('v2', CACHE_QUIET));
    now = Date.parse('2026-06-17T06:00:00Z');
    const refreshed = await request(answering('v3', CACHE_QUIET));

    expect([await body(held), await body(refreshed)]).toEqual(['v1', 'v3']);
  });

  test('a lapsed copy answers when the handler fails, briefly, so recovery shows fast', async () => {
    await request(answering('v1'));
    now += 600_000;

    const res = await request(failing());

    expect(res.status).toBe(200);
    expect(await body(res)).toBe('v1');
    expect(res.headers.get('x-snapshot')).toBe('stale');
    expect(res.headers.get('Cache-Control')).toBe(CACHE_ACTIVE);
  });

  test('never stores an error or a non-public answer', async () => {
    await request(() => Response.json({ data: null, error: { code: 'NOT_FOUND', message: '' } }, { status: 404 }));
    await request(() => Response.json({ data: 'private', error: null }));

    expect(bucket.objects.size).toBe(0);
  });

  test('keys on the params the route reads, so padded and reordered URLs share one copy', async () => {
    await request(answering('v1'), '/data?year=2025&utm_source=x');
    const res = await request(answering('v2'), '/data?gclid=y&year=2025');

    expect(await body(res)).toBe('v1');
    expect([...bucket.objects.keys()]).toEqual(['v1/data?year=2025']);
  });

  test('bumping SNAPSHOT_VERSION starts from an empty store', async () => {
    await request(answering('v1'));

    const res = await request(answering('v2'), '/data', { ...PRODUCTION, SNAPSHOT_VERSION: '2' });

    expect(await body(res)).toBe('v2');
    expect([...bucket.objects.keys()].sort()).toEqual(['v1/data', 'v2/data']);
  });

  test('a bucket that fails is skipped instead of failing the request', async () => {
    bucket.failing = true;

    const res = await request(answering('v1'));

    expect(res.status).toBe(200);
    expect(await body(res)).toBe('v1');
  });

  test('without a bucket every request reaches the handler', async () => {
    const app = appWith(undefined, clock, answering('v1'));
    await app.request('/data', undefined, PRODUCTION);

    const res = await appWith(undefined, clock, answering('v2')).request('/data', undefined, PRODUCTION);

    expect(await body(res)).toBe('v2');
  });
});

describe('snapshotStore default binding', () => {
  const app = (answer: () => Response) => {
    const hono = new Hono<{ Bindings: Bindings }>();
    hono.use('*', snapshotStore());
    hono.get('/data', readsQuery([], () => answer()));
    return hono;
  };

  test('reads the SNAPSHOTS binding', async () => {
    const bucket = new FakeSnapshotBucket();
    await app(answering('v1')).request('/data', undefined, { ...PRODUCTION, SNAPSHOTS: bucket });

    expect(bucket.objects.size).toBe(1);
  });

  test('local dev never uses it: nothing there knows when the dev database changes', async () => {
    const bucket = new FakeSnapshotBucket();
    await app(answering('v1')).request('/data', undefined, { ...PRODUCTION, ENVIRONMENT: 'development', SNAPSHOTS: bucket });

    expect(bucket.objects.size).toBe(0);
  });
});
