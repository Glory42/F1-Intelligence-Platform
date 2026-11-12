import type { MiddlewareHandler } from 'hono';
import { maxAgeSeconds } from './cache';
import { cacheKeyUrl, cacheVersion } from './query-params';

export interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

// Neon Free suspends the database until the 1st once the month's compute is spent: a copy is kept
// this long past its freshness so pages keep answering with the last data instead of erroring.
export const STALE_FOR_SECONDS = 30 * 86400;
const ORIGINAL_CACHE_CONTROL = 'x-edge-cache-control';
const FRESH_UNTIL = 'x-edge-fresh-until';

// Cache-Control alone never caches a Worker's own response; only the Cache API does: and
// only on a custom domain (a no-op on *.workers.dev). Each hit saves a Neon wake + egress.
export function defaultEdgeCache(): EdgeCache | undefined {
  return (globalThis as typeof globalThis & { caches?: { default?: EdgeCache } }).caches?.default;
}

function isCacheable(res: Response): boolean {
  return res.status === 200 && (res.headers.get('Cache-Control') ?? '').includes('public');
}

// Entries stored before the stale window existed carry no marker: the Cache API already expires them.
function isFresh(stored: Response, now: number): boolean {
  const until = stored.headers.get(FRESH_UNTIL);
  return until === null || now < Number(until);
}

function forStorage(res: Response, now: number): Response {
  const headers = new Headers(res.headers);
  for (const name of [...headers.keys()]) {
    if (name.startsWith('access-control-')) headers.delete(name);
  }
  const cacheControl = headers.get('Cache-Control') ?? '';
  const maxAge = maxAgeSeconds(cacheControl);
  headers.set(ORIGINAL_CACHE_CONTROL, cacheControl);
  headers.set(FRESH_UNTIL, String(now + maxAge * 1000));
  headers.set('Cache-Control', `public, max-age=${maxAge + STALE_FOR_SECONDS}`);
  return new Response(res.body, { status: res.status, headers });
}

function forClient(stored: Response): Response {
  const headers = new Headers(stored.headers);
  const original = headers.get(ORIGINAL_CACHE_CONTROL);
  if (original !== null) headers.set('Cache-Control', original);
  headers.delete(ORIGINAL_CACHE_CONTROL);
  headers.delete(FRESH_UNTIL);
  return new Response(stored.body, { status: stored.status, headers });
}

export function edgeCache(
  getCache: () => EdgeCache | undefined = defaultEdgeCache,
  clock: () => number = Date.now,
): MiddlewareHandler {
  return async (c, next) => {
    const cache = c.req.method === 'GET' ? getCache() : undefined;
    if (!cache) return next();

    const url = new URL(cacheKeyUrl(c));
    url.searchParams.set('__v', cacheVersion(c));
    const key = new Request(url.toString(), { method: 'GET' });
    const hit = await cache.match(key);
    if (hit && isFresh(hit, clock())) return forClient(hit);

    await next();
    if (hit && c.res.status >= 500) {
      c.res = forClient(hit);
      return;
    }
    if (!isCacheable(c.res)) return;
    const put = cache.put(key, forStorage(c.res.clone(), clock()));
    try {
      c.executionCtx.waitUntil(put);
    } catch {
      await put;
    }
  };
}
