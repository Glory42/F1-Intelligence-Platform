import type { Context } from 'hono';
import { matchedRoutes } from 'hono/route';

type QueryTagged = { queryParams?: readonly string[] };

// The query params a handler reads. The edge cache keys on these alone, so a URL padded with
// anything else shares the one cached copy instead of waking Neon once per variant.
export function readsQuery<H extends object>(names: readonly string[], handler: H): H {
  return Object.assign(handler, { queryParams: names });
}

export function declaredQueryParams(c: Context): readonly string[] | undefined {
  const route = matchedRoutes(c).find((r) => r.method === 'GET');
  return (route?.handler as QueryTagged | undefined)?.queryParams;
}

// Values come from `read` (c.req.query), so two URLs share a key only when the handler sees the
// same input. A route that declares nothing keeps its full URL: never a wrong answer, just no merge.
export function canonicalCacheUrl(
  url: string,
  params: readonly string[] | undefined,
  read: (name: string) => string | undefined,
): string {
  if (!params) return url;
  const { origin, pathname } = new URL(url);
  const key = new URL(pathname, origin);
  for (const name of [...params].sort()) {
    const value = read(name);
    if (value !== undefined) key.searchParams.set(name, value);
  }
  return key.toString();
}

export function cacheKeyUrl(c: Context): string {
  return canonicalCacheUrl(c.req.url, declaredQueryParams(c), (name) => c.req.query(name));
}
