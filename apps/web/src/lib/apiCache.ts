import { defaultPageCache, pageCacheControl, type PageCache } from '@/lib/pageCache';

// Each fetch to the API's public URL is a billed Worker request (100k/day on Workers Free, shared
// with every Worker on the account), even when the API answers from its own edge cache.
export function defaultApiCache(): PageCache | undefined {
  return import.meta.env.DEV ? undefined : defaultPageCache();
}

function maxAgeSeconds(cacheControl: string): number {
  return Number(/max-age=(\d+)/.exec(cacheControl)?.[1] ?? 0);
}

// Held no longer than a page is, so a backfill or SNAPSHOT_VERSION bump shows up as fast as before.
function storedCacheControl(apiCacheControl: string, now: Date): string | null {
  if (!apiCacheControl.includes('public')) return null;
  const maxAge = Math.min(maxAgeSeconds(apiCacheControl), maxAgeSeconds(pageCacheControl(now)));
  return maxAge > 0 ? `public, max-age=${maxAge}` : null;
}

export async function fetchApiCached(
  url: string,
  cache: PageCache | undefined,
  load: (url: string) => Promise<Response> = fetch,
  now: Date = new Date(),
): Promise<Response> {
  if (!cache) return load(url);
  const key = new Request(url, { method: 'GET' });
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) return hit;

  const res = await load(url);
  const cacheControl = res.status === 200 ? storedCacheControl(res.headers.get('Cache-Control') ?? '', now) : null;
  if (!cacheControl) return res;
  const body = await res.text();
  const headers = { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json', 'Cache-Control': cacheControl };
  await cache.put(key, new Response(body, { status: 200, headers })).catch(() => undefined);
  return new Response(body, { status: 200, headers });
}
