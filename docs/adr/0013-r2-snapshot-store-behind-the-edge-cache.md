# One global copy per API answer in R2, behind the edge cache

The edge cache (ADR 0005) is per data centre: visitors and crawlers spread over many data centres each
miss once per `max-age`, and each miss can wake Neon for at least 5 minutes. In November 2026 that kept
Neon Free on course to run out around the 24th (~4 CU-h a day against a ~2.8 budget). Most answers
can't have changed since the last miss: nothing writes Neon outside a few known windows.

`snapshotStore()` (`apps/api/src/common/snapshot-store.ts`) sits between `edgeCache()` and the handlers
and keeps one copy of every public 200 answer in the private R2 bucket `f1-api-snapshots`, keyed by
`v{SNAPSHOT_VERSION}` + the edge cache's canonical URL (path + only the params the route reads).

**Freshness follows the write windows, not the `max-age`** (`snapshotFreshUntil` in `common/cache.ts`).
Every scheduled Neon write falls in one of two windows: the worker's race weekend (Friday 00:00 UTC until
Tuesday 00:00, since it keeps retrying until 24 h after a Sunday race) and the weekly F1DB import
(Wednesday 06:00–09:00 UTC). A copy written outside them is held until the next one opens; a completed
answer (`immutable`) is kept for good. A copy written inside a window lasts only its `max-age`, so a race
weekend still refreshes every 10 minutes, but once per URL worldwide instead of once per data centre.

## Consequences

- **Neon is read once per URL per write window.** Between race weekends it should only wake for the first
  visit to each page after Wednesday's import and after the weekend.
- **A hit never outlives its copy downstream.** The `max-age` on a hit is cut to the time the copy has left,
  so the edge cache can't add a second `max-age` on top.
- **Outages.** If the refresh fails with a 5xx, the lapsed copy answers (`x-snapshot: stale`, 10-minute
  `Cache-Control`), from every data centre, not only those that still had one. An R2 error falls through
  to Neon.
- **Manual writes need a version bump.** A local backfill, a manual `python -m src.main` run or a manual F1DB
  import outside the windows isn't seen until the next window. Bump `SNAPSHOT_VERSION` (a dashboard variable)
  to start from an empty store; old versions are deleted by the bucket's 90-day lifecycle rule, which also
  re-reads every completed answer once a quarter.
- **Local dev never uses it** (`ENVIRONMENT = "development"`): wrangler's simulated bucket wouldn't know when
  the dev database changes.
- **Free tier, and why R2 rather than KV.** KV Free's 1,000 writes a day ran out within hours (ADR 0012).
  R2 Free allows 1M writes and 10M reads a month (10 GB). Writes are at most one per URL per window and
  reads one per edge miss, both bounded by Workers Free's 100,000 requests a day; in practice a few thousand
  a day. Unlike KV, R2 doesn't refuse past the allowance but bills, so check its usage after the first weeks.
- `x-snapshot: hit` marks an answer that came from the store (or a data centre's copy of one).
