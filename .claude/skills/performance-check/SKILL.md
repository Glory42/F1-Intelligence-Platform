---
name: performance-check
description: Audits code for performance issues, N+1 queries in Hono services, per-row psycopg2 loops in ETL jobs, sequential awaits that could run in parallel, unbounded list endpoints, missing DB indexes, and Astro pages that serialize fetches instead of parallelizing them. Use when the user says "check performance", "review for perf issues", "/performance-check", or after adding a new API route, service method, or Astro page. Also use proactively before considering a new feature done.
---

# Performance Check: F1 Prediction

Audits code against the constraints in `CLAUDE.md`: the Neon HTTP driver, the "No N+1 queries" rule, and ETL idempotency/timeout constraints. This skill finds violations; it does not fix them unless the user explicitly asks.

## Scope

Default to the current diff (uncommitted changes). Determine scope like this:

1. If the user names specific files/features, scope to those.
2. Otherwise, run `git status` and `git diff` to find changed files. Review those.
3. If the user asks for a "full audit" or there's no diff, scope to `apps/api/src/modules`, `apps/web/src/pages`, and `data-engine/src/jobs`: use the `Explore` agent for the search legwork so this doesn't blow the main context window.

If the diff is small (a handful of files), just read them directly instead of spawning agents.

## Checklist

Work through each area that applies to the files in scope. Skip areas with no relevant files (e.g. skip Python loop checks if no `data-engine/` file changed).

### 1. N+1 queries in Hono services
Grep changed `*.service.ts` files for `.map(async` or `for (...)` loops that issue a query per iteration (`await db.select()...` inside a loop body). CLAUDE.md's API section states this explicitly: "No N+1 queries, all queries use Drizzle joins. Never fetch a list then loop-query for each item."
- Good reference pattern: `predictions.service.ts`, `findHistory()` collects `raceIds`/`sprintRaceIds` first, then batch-fetches with `inArray(...)`, builds a `Map` keyed by `${raceId}:${driverId}`, then does a synchronous `.map()` pass to assemble results. `findIntelStandings()` does the same with a `Map<string, Agg>` keyed by driver code.
- Fix: collect ids, batch-fetch with `inArray()`, build a `Map`, then assemble synchronously.

### 2. Sequential awaits that could be parallel
Read changed service files for consecutive `await` statements where the second call doesn't depend on the first's result. These should be `Promise.all([...])`.
- Reference: `predictions.service.ts` `findHistory()` runs the main/sprint prediction join, the winner lookup, and the probability lookup as three separate `Promise.all` pairs instead of six sequential awaits. `getModelInfo()` does the same for GP vs sprint model version.

### 3. Astro frontmatter fetch waterfalls
CLAUDE.md requires all data fetching happen server-side in Astro frontmatter (`---` blocks). Within a page's frontmatter, check for sequential `await api.getX()` calls where the second call doesn't use the first call's result (e.g. doesn't need an id from the first response). These should be `Promise.all([...])`.
- Check pages with multiple `api.*` calls: `apps/web/src/pages/prediction/[id].astro`, `apps/web/src/pages/races/[id]/index.astro`, `apps/web/src/pages/races/[id]/sprint.astro`, `apps/web/src/pages/circuits/[key].astro`, these are the largest/most data-heavy pages and most likely to have grown a waterfall.
- Fix: `const [a, b, c] = await Promise.all([api.getA(), api.getB(), api.getC()]);`

### 4. Unbounded / unpaginated list endpoints
For any new or changed service method returning an array (race lists, driver career stats, prediction history): check whether it's tied to unbounded growth (history across seasons, lap times). CLAUDE.md doesn't mandate pagination everywhere, but flag any new endpoint returning raw `lap_times` or `sprint_lap_times` rows without a `race_id`/`driver_id` filter: these tables grow every race weekend.

### 5. Missing DB indexes
For any new or changed table in `apps/api/src/db/schema/`: does every column used in a `.where(eq(...))` / `inArray(...)` filter or join elsewhere in the codebase have an index? Check the corresponding migration in `apps/api/drizzle/migrations/` for `CREATE INDEX`.
- Natural-key uniqueness (`UNIQUE(race_id, driver_id)`) is already required by CLAUDE.md's schema conventions: confirm it's present, not just an index.
- After adding an index, confirm a migration file exists in `apps/api/drizzle/migrations/`: schema changes without a matching migration are drift, not just a perf gap (see `codebase-audit` for the drift check itself).

### 6. Per-row query loops in ETL jobs (data-engine/)
Grep changed `data-engine/src/jobs/*.py` files for `for ... in ...:` loops containing `cur.execute(...)` inside the loop body, one query per row instead of a single batched fetch or `upsert()` call.
- Good reference: `data-engine/src/utils/upsert.py`, `upsert()` takes a list of row dicts and does one `execute_batch` INSERT with `ON CONFLICT DO UPDATE`. Every ETL job should build a list of rows first, then call `upsert()` once, not loop-call it per row.
- Exception: a `for` loop that only accumulates values into a list/dict (no `cur.execute` inside) is fine, that's the normal pattern in `compute_features.py`/`compute_sprint_features.py`.
- Render job timeouts mean per-row round trips to Neon are also a reliability risk, not just a perf one: flag these as higher severity than a typical N+1.

### 7. Oversized session fetches
Check any new `openf1_session.load_session(...)` call asks only for the parts the job uses (each part is one paced OpenF1 request against the worker's budget, ADR 0004). For the local FastF1 backfills, check any new `fastf1.get_session(...).load(...)` call includes only the data it needs (`laps=`, `telemetry=`, `weather=`, `messages=` set to `False` where unused): loading `telemetry=True` when telemetry isn't used pulls a large payload per session and slows the job for no benefit. Also confirm `fastf1.Cache.enable_cache(...)` is set up in dev so repeated local runs don't re-hit the FastF1 API.

## Reporting format

Report findings grouped by tier, most severe first. Do not fix anything unless the user asked for that explicitly.

**Tier 1: measurable cost** (N+1 query in a hot API path, per-row DB loop in an ETL job risking a Render timeout, unparallelized Astro page fetch waterfall)
**Tier 2: real but lower-severity** (missing index on a low-traffic table, unnecessary FastF1 payload, minor unbounded list with low realistic row count)

For each finding give: `file:line`, one-line description of the defect, the concrete scenario where it costs something (e.g. "loading `/prediction/[id]` issues 4 sequential round trips instead of 1 parallel batch"), and the fix pattern to apply (point at the reference above rather than re-explaining the pattern each time).

If nothing in scope violates the checklist, say so plainly: don't invent marginal nitpicks to pad the report.
