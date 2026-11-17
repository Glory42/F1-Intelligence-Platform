import { beforeEach, describe, expect, it } from 'vitest';
import { fetchApiCached } from '@/lib/apiCache';
import type { PageCache } from '@/lib/pageCache';

class FakeCache implements PageCache {
  readonly entries = new Map<string, Response>();

  async match(request: Request): Promise<Response | undefined> {
    return this.entries.get(request.url)?.clone();
  }

  async put(request: Request, response: Response): Promise<void> {
    this.entries.set(request.url, response.clone());
  }
}

const URL_SEASONS = 'https://f1-api.example/api/seasons';
const TUESDAY = new Date('2026-11-17T12:00:00Z');
const SATURDAY = new Date('2026-11-21T12:00:00Z');

describe('API response cache', () => {
  let cache: FakeCache;
  let loads: number;

  const api = (cacheControl = 'public, max-age=86400, immutable', status = 200) => async () => {
    loads += 1;
    return new Response(JSON.stringify({ data: loads, error: null }), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': cacheControl },
    });
  };

  beforeEach(() => {
    cache = new FakeCache();
    loads = 0;
  });

  it('answers a repeat read without calling the API Worker again', async () => {
    await fetchApiCached(URL_SEASONS, cache, api(), TUESDAY);
    const repeat = await fetchApiCached(URL_SEASONS, cache, api(), TUESDAY);

    expect(loads).toBe(1);
    expect(await repeat.json()).toEqual({ data: 1, error: null });
  });

  it('hands the caller the same body it stored', async () => {
    const first = await fetchApiCached(URL_SEASONS, cache, api(), TUESDAY);

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ data: 1, error: null });
  });

  it('holds an answer no longer than a page is held', async () => {
    await fetchApiCached(URL_SEASONS, cache, api(), TUESDAY);
    await fetchApiCached(`${URL_SEASONS}?w`, cache, api(), SATURDAY);

    expect(cache.entries.get(URL_SEASONS)?.headers.get('Cache-Control')).toBe('public, max-age=3600');
    expect(cache.entries.get(`${URL_SEASONS}?w`)?.headers.get('Cache-Control')).toBe('public, max-age=300');
  });

  it("keeps the API's shorter max-age", async () => {
    await fetchApiCached(URL_SEASONS, cache, api('public, max-age=600'), TUESDAY);

    expect(cache.entries.get(URL_SEASONS)?.headers.get('Cache-Control')).toBe('public, max-age=600');
  });

  it.each([
    ['an error', 'public, max-age=600', 504],
    ['a not-found', 'public, max-age=600', 404],
    ['an uncacheable answer', 'no-store', 200],
    ['an answer without a max-age', 'public', 200],
  ])('never stores %s', async (_name, cacheControl, status) => {
    await fetchApiCached(URL_SEASONS, cache, api(cacheControl, status), TUESDAY);
    await fetchApiCached(URL_SEASONS, cache, api(cacheControl, status), TUESDAY);

    expect(cache.entries.size).toBe(0);
    expect(loads).toBe(2);
  });

  it('calls the API directly when there is no edge cache', async () => {
    await fetchApiCached(URL_SEASONS, undefined, api(), TUESDAY);
    await fetchApiCached(URL_SEASONS, undefined, api(), TUESDAY);

    expect(loads).toBe(2);
  });

  it('still answers when the cache itself fails', async () => {
    const broken: PageCache = {
      match: () => Promise.reject(new Error('cache down')),
      put: () => Promise.reject(new Error('cache down')),
    };

    const res = await fetchApiCached(URL_SEASONS, broken, api(), TUESDAY);

    expect(await res.json()).toEqual({ data: 1, error: null });
  });
});
