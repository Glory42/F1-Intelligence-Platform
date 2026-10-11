import type { MiddlewareHandler } from 'hono';

interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

// Cache-Control alone never caches a Worker's own response; only the Cache API does: and
// only on a custom domain (a no-op on *.workers.dev). Each hit saves a Neon wake + egress.
function defaultEdgeCache(): EdgeCache | undefined {
  return (globalThis as typeof globalThis & { caches?: { default?: EdgeCache } }).caches?.default;
}

function isCacheable(res: Response): boolean {
  return res.status === 200 && (res.headers.get('Cache-Control') ?? '').includes('public');
}

export function edgeCache(getCache: () => EdgeCache | undefined = defaultEdgeCache): MiddlewareHandler {
  return async (c, next) => {
    const cache = c.req.method === 'GET' ? getCache() : undefined;
    if (!cache) return next();

    const key = new Request(c.req.url, { method: 'GET' });
    const hit = await cache.match(key);
    if (hit) return new Response(hit.body, hit);

    await next();
    if (!isCacheable(c.res)) return;
    const stored = c.res.clone();
    const headers = new Headers(stored.headers);
    for (const name of [...headers.keys()]) {
      if (name.startsWith('access-control-')) headers.delete(name);
    }
    const put = cache.put(key, new Response(stored.body, { status: stored.status, headers }));
    try {
      c.executionCtx.waitUntil(put);
    } catch {
      await put;
    }
  };
}
