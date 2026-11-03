import { beforeEach, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { kvCache } from '../../../src/common/kv-cache';
import { CACHE_ACTIVE } from '../../../src/common/cache';
import type { Bindings } from '../../../src/common/types';
import { FakeKv } from '../../support/kv/fake-kv';
import { FakeEdgeCache } from '../../support/cache/fake-edge-cache';

describe('kvCache write admission', () => {
  let kv: FakeKv;
  let edge: FakeEdgeCache;
  let handlerCalls: number;

  const app = new Hono<{ Bindings: Bindings }>();
  app.use('/api/*', kvCache(() => edge));
  app.get('/api/answer', (c) => {
    handlerCalls += 1;
    return c.json({ data: { call: handlerCalls }, error: null }, 200, { 'Cache-Control': CACHE_ACTIVE });
  });

  const request = (path = '/api/answer') => app.request(path, undefined, { DATABASE_URL: '', API_CACHE: kv });
  const handlerCall = async (res: Response) => ((await res.json()) as { data: { call: number } }).data.call;
  const storedKeys = () => [...kv.entries.keys()].filter((key) => key.startsWith('api:'));

  beforeEach(() => {
    kv = new FakeKv();
    kv.setState({ version: 'v1' });
    edge = new FakeEdgeCache();
    handlerCalls = 0;
  });

  it('does not spend a KV write on a URL asked for only once', async () => {
    await request();

    expect(storedKeys()).toEqual([]);
  });

  it('stores a URL in KV once it is asked for a second time', async () => {
    await request();
    await request();
    const res = await request();

    expect(storedKeys()).toEqual(['api:/api/answer']);
    expect(await handlerCall(res)).toBe(2);
  });

  it('rewrites an already cached URL straight away after a version bump', async () => {
    await request();
    await request();
    edge = new FakeEdgeCache();
    kv.setState({ version: 'v2' });

    await request();
    const res = await request();

    expect(await handlerCall(res)).toBe(3);
  });

  it('writes on the first miss when no edge cache is available (workers.dev)', async () => {
    const noEdge = new Hono<{ Bindings: Bindings }>();
    noEdge.use('/api/*', kvCache(() => undefined));
    noEdge.get('/api/answer', (c) => c.json({ data: 1, error: null }, 200, { 'Cache-Control': CACHE_ACTIVE }));

    await noEdge.request('/api/answer', undefined, { DATABASE_URL: '', API_CACHE: kv });

    expect(storedKeys()).toEqual(['api:/api/answer']);
  });
});
