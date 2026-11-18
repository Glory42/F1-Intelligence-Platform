import { defaultPageCache, type PageCache } from '@/lib/pageCache';
import { BUILD_ID } from '@/lib/buildId';
import { isWriteWindow, pageHoldSeconds } from '@/lib/pageHold';

// Each fetch to the API's public URL is a billed Worker request (100k/day on Workers Free, shared
// with every Worker on the account), even when the API answers from its own edge cache.
export function defaultApiCache(): PageCache | undefined {
  return import.meta.env.DEV ? undefined : defaultPageCache();
}

function maxAgeSeconds(cacheControl: string): number {
  return Number(/max-age=(\d+)/.exec(cacheControl)?.[1] ?? 0);
}

// Held as long as a page is: between write windows the API's answer can't change whatever its
// max-age (ADR 0013), and inside one its own shorter max-age wins.
function storedCacheControl(apiCacheControl: string, now: Date): string | null {
  const apiMaxAge = maxAgeSeconds(apiCacheControl);
  if (!apiCacheControl.includes('public') || apiMaxAge <= 0) return null;
  const hold = pageHoldSeconds(now);
  return `public, max-age=${isWriteWindow(now) ? Math.min(apiMaxAge, hold) : hold}`;
}

// The build is part of the key so a deploy (the way to show a manual write early) starts fresh.
function cacheKey(url: string): Request {
  const key = new URL(url);
  key.searchParams.set('__build', BUILD_ID);
  return new Request(key, { method: 'GET' });
}

export async function fetchApiCached(
  url: string,
  cache: PageCache | undefined,
  load: (url: string) => Promise<Response> = fetch,
  now: Date = new Date(),
): Promise<Response> {
  if (!cache) return load(url);
  const key = cacheKey(url);
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
