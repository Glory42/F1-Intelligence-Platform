import { canonicalPageSearch } from '@/lib/pageQuery';
import { BUILD_ID } from '@/lib/buildId';
import { pageHoldSeconds } from '@/lib/pageHold';

export interface PageCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export type RunInBackground = (work: Promise<unknown>) => void;

// Workers Free cuts a render off at 10 ms of CPU and an uncached page takes 15–100 ms, so a page
// rendered once is served from the edge until its data can next change (lib/pageHold.ts).
export function pageCacheControl(now: Date): string {
  return `public, max-age=${pageHoldSeconds(now)}`;
}

// The Cache API only works on a custom domain: on *.pages.dev and in astro dev this is a no-op.
export function defaultPageCache(): PageCache | undefined {
  return (globalThis as typeof globalThis & { caches?: { default?: PageCache } }).caches?.default;
}

// No cookie in the key: the sidebar's collapsed state is applied in the browser (BaseLayout.astro).
export function pageCacheKey(url: URL, build: string = BUILD_ID): Request {
  const key = new URL(url.pathname + canonicalPageSearch(url), url.origin);
  key.searchParams.set('__build', build);
  return new Request(key, { method: 'GET' });
}

// Pages plus the feeds built like them (sitemap, calendar): each render reads the same cached API.
const CACHEABLE_TYPES = ['text/html', 'application/xml', 'text/calendar'];
// A not-found is kept too: it's the same on every render, and crawlers retry unknown ids.
const CACHEABLE_STATUSES = [200, 404];

function isCacheablePage(res: Response): boolean {
  const type = res.headers.get('Content-Type') ?? '';
  const cacheable = CACHEABLE_TYPES.some((t) => type.includes(t));
  return CACHEABLE_STATUSES.includes(res.status) && cacheable
    && !res.headers.has('Set-Cookie') && !res.headers.has('Cache-Control');
}

// Only the edge copy carries Cache-Control: the browser always asks again.
function forVisitor(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.delete('Cache-Control');
  return new Response(res.body, { status: res.status, headers });
}

export interface PageCacheOptions {
  runInBackground: RunInBackground;
  // True once the render has shown a fallback for an API outage; read after the body is complete.
  degraded?: () => boolean;
  now?: Date;
}

export async function servePageCached(
  request: Request,
  render: () => Promise<Response>,
  cache: PageCache | undefined,
  { runInBackground, degraded = () => false, now = new Date() }: PageCacheOptions,
): Promise<Response> {
  if (!cache || request.method !== 'GET') return render();
  const key = pageCacheKey(new URL(request.url));
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) return forVisitor(hit);

  const res = await render();
  if (!isCacheablePage(res)) return res;
  // Astro streams the page, so whether a fetch failed is only known once the whole body is out.
  const body = await res.text();
  const page = new Response(body, { status: res.status, headers: res.headers });
  if (degraded()) return page;
  const stored = new Response(body, { status: res.status, headers: new Headers(res.headers) });
  stored.headers.set('Cache-Control', pageCacheControl(now));
  runInBackground(cache.put(key, stored).catch(() => undefined));
  return page;
}
