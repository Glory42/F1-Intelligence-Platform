import { beforeEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { STALE_FOR_SECONDS, edgeCache } from '../../../src/common/edge-cache';
import { FakeEdgeCache } from '../../support/cache/fake-edge-cache';

const TEN_MINUTES = 600_000;

function appWith(cache: FakeEdgeCache, clock: () => number, answer: () => Response) {
  const app = new Hono();
  app.use('*', edgeCache(() => cache, clock));
  app.get('/data', () => answer());
  app.onError((_, c) => c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'down' } }, 500));
  return app;
}

const fresh = (version: string) => () =>
  Response.json({ data: version, error: null }, { headers: { 'Cache-Control': 'public, max-age=600' } });

const body = async (res: Response) => ((await res.json()) as { data: string | null }).data;

describe('edgeCache', () => {
  let cache: FakeEdgeCache;
  let now: number;
  const clock = () => now;

  beforeEach(() => {
    cache = new FakeEdgeCache();
    now = Date.parse('2026-11-10T12:00:00Z');
  });

  test('a repeat within the max-age is answered from the cache with the original Cache-Control', async () => {
    await appWith(cache, clock, fresh('v1')).request('/data');
    now += TEN_MINUTES - 1;

    const res = await appWith(cache, clock, fresh('v2')).request('/data');

    expect(await body(res)).toBe('v1');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=600');
    expect(res.headers.get('x-edge-fresh-until')).toBeNull();
  });

  test('keeps the copy for the stale window on top of its max-age', async () => {
    await appWith(cache, clock, fresh('v1')).request('/data');

    const [stored] = cache.entries.values();

    expect(stored.headers.get('Cache-Control')).toBe(`public, max-age=${600 + STALE_FOR_SECONDS}`);
  });

  test('once past its max-age the copy is refreshed from the database', async () => {
    await appWith(cache, clock, fresh('v1')).request('/data');
    now += TEN_MINUTES;

    const res = await appWith(cache, clock, fresh('v2')).request('/data');
    const again = await appWith(cache, clock, fresh('v3')).request('/data');

    expect([await body(res), await body(again)]).toEqual(['v2', 'v2']);
  });

  test('a lapsed copy answers when the database fails, so an outage keeps the last data on screen', async () => {
    await appWith(cache, clock, fresh('v1')).request('/data');
    now += 7 * 86_400_000;

    const res = await appWith(cache, clock, () => { throw new Error('quota exceeded'); }).request('/data');

    expect(res.status).toBe(200);
    expect(await body(res)).toBe('v1');
  });

  test('a failure with nothing cached still reports the error', async () => {
    const res = await appWith(cache, clock, () => { throw new Error('quota exceeded'); }).request('/data');

    expect(res.status).toBe(500);
    expect(cache.entries.size).toBe(0);
  });

  test('a 404 is passed through rather than replaced by a lapsed copy', async () => {
    await appWith(cache, clock, fresh('v1')).request('/data');
    now += TEN_MINUTES;

    const res = await appWith(cache, clock, () => Response.json({ data: null }, { status: 404 })).request('/data');

    expect(res.status).toBe(404);
  });
});
