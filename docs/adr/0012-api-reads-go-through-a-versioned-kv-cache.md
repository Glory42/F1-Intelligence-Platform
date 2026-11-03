# API reads go through a versioned KV cache

In November 2026, Neon Free's 100 CU-h ran out around day 25 for the second month running. Neon's API
showed the compute awake 77% of the time with ~85 wakes a day, most of them outside race weekends,
when the worker never touches the database. Every SSR page view reached Neon: the edge cache
(ADR 0005) was a no-op on `*.workers.dev`, and current-season routes were cached for only 30 s.
Each wake bills at least 5 minutes, so what matters is how often anything reaches Neon, not how fast
its queries are.

`kvCache()` (`apps/api/src/common/kv-cache.ts`) keeps every public 200 answer in Workers KV, one key
per normalized URL. The data engine stores a **data version** in KV (`data-engine/src/utils/api_cache.py`)
and bumps it after anything that writes Neon: the worker cycle, the CLI, the backfill scripts and the
F1DB import. An entry is served while its version matches the current one. `CACHE_COMPLETED` answers
(a finished race, a past season) are served whatever the version, because they can't change. Neon
is read only on a real miss, and only once per URL after each bump.

## Consequences

- **Neon never serves a repeat read.** It wakes for ETL writes and for the first view of each page
  after new data lands.
- **Stale beats down.** If the handler fails (Neon suspended or over quota), the last stored answer is
  served for 30 s at a time.
- **Budget watchdog.** It runs in the worker's existing cycle and reads Neon's control-plane API,
  which doesn't wake the compute. Once 80 CU-h or 4 GB are actually used, it sets `serveStale` in KV,
  and every cached answer is served regardless of version. A month only projected past the budget
  is just logged: switching on a projection would hide fresh race results on a guess.
- **KV Free limits are degraded around.** It allows 100k reads and 1k writes a day. A refused read
  falls through to Neon, and a refused write only means the next request misses again.
- **A URL earns its KV write on its second miss.** On 2026-11-03 a crawler used 933 of the 1,000
  daily writes on URLs it asked for once, while reads stayed under 3k. The first miss now only leaves
  a marker in the edge cache, which has no quota. A URL already in KV is rewritten straight away
  after a bump. Each new URL costs Neon one extra read, and one-off URLs stop using writes.
- **The edge cache still sits in front.** The API moved to `f1-api.gorkemkaryol.dev`, so ADR 0005's
  cache now works too and absorbs repeats per data centre before they count as KV reads.
- **Every writer must bump.** A writer that skips the bump leaves the site showing the old data
  until the next one does.
