# Architectural Decisions

Key non-obvious choices made in this project and why. Read this before proposing changes to the stack or structure.

This file predates the per-decision `docs/adr/000N-slug.md` convention (hence `0000`) and stays as a
single consolidated record for decisions made before that convention existed. New decisions go in
their own numbered file (see `0001-*.md` onward): don't add new entries here.

---

## Cloudflare Workers: HTTP driver only, no TCP

Workers run in V8 isolates with no TCP socket support. The API layer **must** use `@neondatabase/serverless` (HTTP driver). Never introduce `pg`, `postgres`, or Prisma in `apps/api/`: they all require TCP and will silently fail or refuse to build.

Python on Render is a normal server, so psycopg2 over TCP is fine there.

---

## Python writes directly to Neon: the API is read-only

The ETL engine connects directly to Neon via psycopg2. The Hono API has no write endpoints. This keeps the API surface minimal and avoids a redundant HTTP hop from Render → Cloudflare → Neon when Render can just hit Neon directly.

---

## SSR over SSG for the frontend

SSG would be faster (pre-rendered HTML at CDN edge) but requires a triggered rebuild after every ETL run. SSR on Cloudflare Pages is simpler: pages always reflect the current DB state without any build pipeline coupling. Revisit only if page latency becomes a problem.

---

## Pre-computed predictions, not on-request scoring

The softmax model runs once after qualifying (Saturday cron) and stores results in `race_predictions` and `driver_prediction_features`. The API just reads those rows. There is no value in recomputing per request: the inputs don't change until the next qualifying session.

No Redis needed. The DB rows are the cache.

---

## `driver_prediction_features` stores normalized scores, not raw inputs

The features table stores 0–1 normalized scores per driver per race, not the raw qualifying times or points totals. Raw inputs are already in `qualifying_results`, `race_results`, and `driver_season_stats`. Storing normalized scores means the table is immediately training-ready as an ML dataset without re-running the pipeline.

---

## Teams and drivers are season-scoped

A `teams` row and a `drivers` row exist per year, not globally. Teams rename (Toro Rosso → AlphaTauri → RB), drivers switch teams, and car numbers change. Scoping by season avoids complex update logic and makes historical data unambiguous.

---

## `race.status` as ETL control valve

The `status` enum (`scheduled → sprint_qualifying_done → sprint_done → qualifying_done → completed`) is what the pipeline uses to decide what to run next. `compute_features` only runs when `qualifying_done`: it raises if qualifying data is missing rather than producing zeroed-out predictions. Status is updated at the **end** of each job (not the start) to avoid race conditions where a partial job marks a race as ready.

---

## Lap times as integer milliseconds

All lap and sector times are stored as `INTEGER` milliseconds, never floats. No floating-point precision issues, trivially sortable, and compatible with any arithmetic in the prediction model.

---

## Softmax temperature T=0.3

Lower temperature makes the model more decisive: small score differences produce larger probability gaps. F1 is not uniform; the dominant car wins ~60–70% of races. T=0.3 reflects that. Do not increase it without evaluating accuracy across past seasons.

---

## No user auth

The platform is a read-only data product. There is nothing to protect on a per-user basis. Adding auth would add complexity with no benefit to the core prediction use case.

---

## What NOT to do

- `pg` / `postgres` / Prisma in `apps/api/`: no TCP in CF Workers
- `client:*` islands for data fetching in Astro: all fetches in frontmatter
- Write endpoints on the Hono API: ETL writes directly to Neon
- Secrets in `wrangler.toml`: use the Cloudflare dashboard (Variables and Secrets)
- `sleep()` in ETL jobs: Render has a job timeout; exit code 1 and retrigger manually
