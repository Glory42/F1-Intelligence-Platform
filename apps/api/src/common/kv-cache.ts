import type { Context, MiddlewareHandler } from 'hono';
import type { Bindings, KvStore } from './types';
import { CACHE_ACTIVE } from './cache';
import { defaultEdgeCache, type EdgeCache } from './edge-cache';

type Ctx = Context<{ Bindings: Bindings }>;
type CacheState = { version?: string; serveStale?: boolean };
type EntryMeta = { version: string | null; cacheControl: string };

// Written by the data engine (data-engine/src/utils/api_cache.py) whenever Neon's data changes.
const STATE_KEY = 'meta:state';
const SEEN_FOR = 'public, max-age=86400';

async function readState(kv: KvStore): Promise<CacheState> {
  const raw = await kv.get(STATE_KEY);
  return raw ? (JSON.parse(raw) as CacheState) : {};
}

function entryKey(url: string): string {
  const { pathname, searchParams } = new URL(url);
  searchParams.sort();
  const query = searchParams.toString();
  return `api:${pathname}${query ? `?${query}` : ''}`;
}

// CACHE_COMPLETED answers (a finished race, a past season) can't change, so no version bump expires them.
// serveStale is the data engine's Neon budget watchdog: past the budget, any cached answer will do.
function isFresh(meta: EntryMeta, state: CacheState): boolean {
  return meta.cacheControl.includes('immutable') || meta.version === (state.version ?? null) || state.serveStale === true;
}

function cachedResponse(body: string, cacheControl: string): Response {
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': cacheControl } });
}

function runInBackground(c: Ctx, work: Promise<void>): Promise<void> | undefined {
  try {
    c.executionCtx.waitUntil(work);
    return undefined;
  } catch {
    return work;
  }
}

// KV Free allows 1,000 writes a day and a crawler asks for most URLs once, so a new URL is only written
// on its second miss in a data centre. The first leaves a marker in the edge cache, which has no quota.
async function admit(doorkeeper: EdgeCache | undefined, url: string): Promise<boolean> {
  if (!doorkeeper) return true;
  const marker = new Request(`${new URL(url).origin}/__kv-seen/${encodeURIComponent(entryKey(url))}`);
  if (await doorkeeper.match(marker)) return true;
  await doorkeeper.put(marker, new Response('1', { headers: { 'Cache-Control': SEEN_FOR } }));
  return false;
}

// Durable read-through cache in front of Neon: an entry stays valid until the data version changes.
export function kvCache(
  getDoorkeeper: () => EdgeCache | undefined = defaultEdgeCache,
): MiddlewareHandler<{ Bindings: Bindings }> {
  return async (c, next) => {
    // wrangler dev simulates KV locally and nothing bumps it there: it would replay stale answers.
    const local = c.env?.ENVIRONMENT === 'development';
    const kv = c.req.method === 'GET' && !local ? c.env?.API_CACHE : undefined;
    if (!kv) return next();

    const key = entryKey(c.req.url);
    const lookup = await Promise.all([kv.getWithMetadata<EntryMeta>(key), readState(kv)]).catch(() => null);
    // KV Free allows 100,000 reads a day; past that, Neon answers on its own as before.
    if (!lookup) return next();
    const [entry, state] = lookup;
    const version = state.version ?? null;
    if (entry.value !== null && entry.metadata && isFresh(entry.metadata, state)) {
      return cachedResponse(entry.value, entry.metadata.cacheControl);
    }

    await next();
    if (c.res.status >= 500 && entry.value !== null) {
      // Neon down or over quota: an old answer beats a 500. Short-lived, so recovery shows fast.
      c.res = cachedResponse(entry.value, CACHE_ACTIVE);
      return;
    }
    const cacheControl = c.res.headers.get('Cache-Control') ?? '';
    if (c.res.status !== 200 || !cacheControl.includes('public')) return;
    const response = c.res.clone();
    const knownUrl = entry.value !== null;
    const store = (knownUrl ? Promise.resolve(true) : admit(getDoorkeeper(), c.req.url))
      .then(async (admitted) => {
        if (!admitted) return;
        const body = await response.text();
        await kv.put(key, body, { metadata: { version, cacheControl } satisfies EntryMeta });
      })
      // A refused write (KV Free allows 1,000 a day) only means the next request misses again.
      .catch(() => undefined);
    const pending = runInBackground(c, store);
    if (pending) await pending;
  };
}
