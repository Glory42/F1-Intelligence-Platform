# API responses are served from the Workers edge cache

A `Cache-Control` header on a Worker's own response does not make Cloudflare cache it — only the
Workers Cache API does. Without it every page view queried Neon, spending Free-tier compute and
egress. `edgeCache()` (`apps/api/src/common/edgeCache.ts`) stores 200 responses that carry a public
`Cache-Control` (set per route via `src/common/cache.ts`) and replays them on later requests, with
CORS headers stripped from the stored copy so `cors()` always answers for the current origin.

## Consequences

The Cache API only works on a custom domain; on `*.workers.dev` it is a silent no-op. The API Worker
must be attached to a custom domain (and `PUBLIC_API_URL` pointed at it) before this saves anything.
The cache is per data centre and honours `max-age`, so active-weekend routes (`max-age=30`) refresh
quickly while completed races are kept for a day.
