import { SIDEBAR_COOKIE, isSidebarCollapsed } from '@/lib/sidebarState';

export interface PageCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export type RunInBackground = (work: Promise<unknown>) => void;

// Workers Free cuts a render off at 10 ms of CPU and a typical page takes about that, so a page
// rendered once is served from the edge for a few minutes. The data only moves when the ETL runs.
const STORED_FOR = 'public, max-age=300';

// The Cache API only works on a custom domain: on *.pages.dev and in astro dev this is a no-op.
export function defaultPageCache(): PageCache | undefined {
  return (globalThis as typeof globalThis & { caches?: { default?: PageCache } }).caches?.default;
}

// The sidebar cookie is the only request input a page renders from, so it is part of the key.
export function pageCacheKey(url: URL, cookieHeader: string | null): Request {
  const key = new URL(url);
  const collapsed = isSidebarCollapsed(readCookie(cookieHeader, SIDEBAR_COOKIE));
  key.searchParams.set('__sidebar', collapsed ? 'collapsed' : 'expanded');
  return new Request(key, { method: 'GET' });
}

function readCookie(header: string | null, name: string): string | undefined {
  const pair = header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return pair?.slice(name.length + 1);
}

function isCacheablePage(res: Response): boolean {
  const html = (res.headers.get('Content-Type') ?? '').includes('text/html');
  return res.status === 200 && html && !res.headers.has('Set-Cookie') && !res.headers.has('Cache-Control');
}

// Only the edge copy carries Cache-Control: a browser copy would ignore the sidebar cookie.
function forVisitor(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.delete('Cache-Control');
  return new Response(res.body, { status: res.status, headers });
}

export async function servePageCached(
  request: Request,
  render: () => Promise<Response>,
  cache: PageCache | undefined,
  runInBackground: RunInBackground,
): Promise<Response> {
  if (!cache || request.method !== 'GET') return render();
  const key = pageCacheKey(new URL(request.url), request.headers.get('Cookie'));
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) return forVisitor(hit);

  const res = await render();
  if (!isCacheablePage(res)) return res;
  const stored = new Response(res.clone().body, { status: res.status, headers: new Headers(res.headers) });
  stored.headers.set('Cache-Control', STORED_FOR);
  runInBackground(cache.put(key, stored).catch(() => undefined));
  return res;
}
