# API responses are served from the Workers edge cache

A `Cache-Control` header on a Worker's own response does not make Cloudflare cache it: only the
Workers Cache API does. Without it every page view queried Neon, spending Free-tier compute and
egress. `edgeCache()` (`apps/api/src/common/edge-cache.ts`) stores 200 responses that carry a public
`Cache-Control` (set per route via `src/common/cache.ts`) and replays them on later requests, with
CORS headers stripped from the stored copy so `cors()` always answers for the current origin.

## Consequences

The Cache API only works on a custom domain; on `*.workers.dev` it is a silent no-op. The API Worker
must be attached to a custom domain (and `PUBLIC_API_URL` pointed at it) before this saves anything.
The cache is per data centre. In-progress data refreshes within 10 minutes from Friday to Monday noon
UTC, when the ETL ingests (`isIngestWindow`), and within an hour between race weekends; completed races
are kept for a day. They were 30 s until November 2026: with traffic spread over many data centres
that reached Neon every few minutes and never let it sleep.

Each copy is stored for 30 days past its `max-age`. A fresh copy is replayed; a lapsed one is refreshed
from Neon, but answers instead when the refresh fails with a 5xx. Neon Free suspends the database once
the month's compute is spent, and this keeps every answer a data centre has seen online until the 1st.

The API moved to `f1-api.gorkemkaryol.dev` in November 2026, which turned this cache on. A versioned
Workers KV cache behind it (ADR 0012) was removed a day later: KV Free's write cap ran out within hours.
Since then one global copy per answer sits behind this cache in R2 (ADR 0013).
