import type { Context, MiddlewareHandler } from 'hono';
import type { Bindings } from './types';
import { CACHE_ACTIVE, maxAgeSeconds, snapshotFreshUntil } from './cache';
import { cacheKeyUrl } from './query-params';

// The subset of an R2 bucket binding the store uses, so tests can pass an in-memory one.
export interface SnapshotObject {
  text(): Promise<string>;
  customMetadata?: Record<string, string>;
}
export type SnapshotPutOptions = { customMetadata: Record<string, string> };
export interface SnapshotBucket {
  get(key: string): Promise<SnapshotObject | null>;
  put(key: string, value: string, options: SnapshotPutOptions): Promise<unknown>;
}

type Ctx = Context<{ Bindings: Bindings }>;
type Snapshot = { body: string; cacheControl: string; contentType: string; freshUntil: number };

// wrangler dev simulates R2 locally, and nothing there knows when the dev database changes.
function defaultBucket(c: Ctx): SnapshotBucket | undefined {
  return c.env?.ENVIRONMENT === 'development' ? undefined : c.env?.SNAPSHOTS;
}

async function read(bucket: SnapshotBucket, key: string): Promise<Snapshot | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  const meta = object.customMetadata ?? {};
  return {
    body: await object.text(),
    cacheControl: meta.cacheControl ?? CACHE_ACTIVE,
    contentType: meta.contentType ?? 'application/json',
    freshUntil: Number(meta.freshUntil ?? 0),
  };
}

function answer(snapshot: Snapshot, cacheControl: string, state: 'hit' | 'stale'): Response {
  return new Response(snapshot.body, {
    headers: { 'Content-Type': snapshot.contentType, 'Cache-Control': cacheControl, 'x-snapshot': state },
  });
}

// The edge cache in front keeps a hit for its max-age: never longer than the copy itself has left.
function remainingCacheControl(snapshot: Snapshot, now: number): string {
  const left = Math.max(0, Math.floor((snapshot.freshUntil - now) / 1000));
  const maxAge = Math.min(maxAgeSeconds(snapshot.cacheControl), left);
  return snapshot.cacheControl.replace(/max-age=\d+/, `max-age=${maxAge}`);
}

function runInBackground(c: Ctx, work: Promise<void>): Promise<void> | undefined {
  try {
    c.executionCtx.waitUntil(work);
    return undefined;
  } catch {
    return work;
  }
}

// One global copy per URL in R2, behind the per-data-centre edge cache: Neon is read once per URL
// per write window instead of once per data centre per max-age (ADR 0013).
export function snapshotStore(
  getBucket: (c: Ctx) => SnapshotBucket | undefined = defaultBucket,
  clock: () => number = Date.now,
): MiddlewareHandler<{ Bindings: Bindings }> {
  return async (c, next) => {
    const bucket = c.req.method === 'GET' ? getBucket(c) : undefined;
    if (!bucket) return next();

    const { pathname, search } = new URL(cacheKeyUrl(c));
    const key = `v${c.env?.SNAPSHOT_VERSION ?? '1'}${pathname}${search}`;
    // An R2 outage only means Neon answers, as it did before the store existed.
    const stored = await read(bucket, key).catch(() => null);
    const now = clock();
    if (stored && now < stored.freshUntil) return answer(stored, remainingCacheControl(stored, now), 'hit');

    await next();
    if (stored && c.res.status >= 500) {
      c.res = answer(stored, CACHE_ACTIVE, 'stale');
      return;
    }
    const cacheControl = c.res.headers.get('Cache-Control') ?? '';
    if (c.res.status !== 200 || !cacheControl.includes('public')) return;
    const response = c.res.clone();
    const customMetadata = {
      cacheControl,
      contentType: response.headers.get('Content-Type') ?? 'application/json',
      freshUntil: String(snapshotFreshUntil(cacheControl, new Date(now))),
    };
    const write = response.text()
      .then((body) => bucket.put(key, body, { customMetadata }))
      .then(() => undefined, () => undefined);
    const pending = runInBackground(c, write);
    if (pending) await pending;
  };
}
