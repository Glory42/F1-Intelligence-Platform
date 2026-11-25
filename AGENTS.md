# F1 Intelligence Platform: Agent Guide

This is the canonical guide for every coding agent working in this repo. Codex, opencode and other
`AGENTS.md` readers load it directly; Claude Code loads it through the `@AGENTS.md` import in `CLAUDE.md`.

Keep this file under 32 KiB (Codex truncates project instructions past its default
`project_doc_max_bytes`, and silently drops the tail): detail belongs in `docs/` or `CODEMAP.md`. The
authoritative table list, route list, pages and model numbers live in `docs/`; this file keeps the rules.

Read on demand, never up front: `docs/architecture.md` (how the layers connect),
`docs/database-schema.md` (every table), `docs/api-reference.md` (every route), `docs/frontend.md`
(pages and conventions), `docs/prediction-model.md` (model and backtests), `docs/testing.md` (every
suite), `CODEMAP.md` (file-level map).

## Agent Skills
Skills are in `.claude/skills/` and mirrored byte-for-byte into `.agents/skills/`, Codex's location: Codex
does not read `.claude/skills` and Claude Code does not read `.agents/skills`, so a skill has to exist in
both. Edit `.claude/skills/<name>/SKILL.md`, then run `cp -a .claude/skills/. .agents/skills/`; CI fails on
drift (`diff -r`). Invoke one by name (Claude Code `/commit`; Codex `/skills` or `$commit`) or let the agent
pick it from its description. Available: `backfill`, `build`, `codebase-audit`, `codebase-cleanup`,
`commit`, `performance-check`, `refactor-hunt`.

## Project Overview
F1 analysis platform (brand: `SITE_NAME` in `apps/web/src/lib/site.ts`). Uses historical + current F1
data (OpenF1, Jolpica, F1DB; FastF1 for pre-2023 backfills) for race analysis and to predict race winners with a weighted feature scoring
system. Roadmap and free-tier budget rules: `docs/plans/intelligence-platform-roadmap.md`.

## Monorepo Layout
```
f1-intelligence/
├── apps/
│   ├── web/       # Astro SSR on Cloudflare Pages
│   ├── api/       # Hono on Cloudflare Workers (NestJS-style modules)
│   │              # Also owns the Drizzle schema (src/db/schema/) and migrations (drizzle/migrations/)
│   ├── e2e/       # Playwright smoke tests for apps/web: own package.json + playwright.config.ts
│   └── og/        # Share-image renderer (satori) run by a GitHub Action into a public R2 bucket (ADR 0016)
└── data-engine/   # Python ETL batch jobs on Render
```
`apps/` is a JS/Bun-only convention: root `package.json` orchestrates `apps/api`, `apps/web`, and
`apps/e2e` via plain `cd`-based scripts (no Bun workspaces). `data-engine/` stays outside `apps/`:
it's Python, and its jobs run once and exit rather than being a long-running dev server. See
`docs/adr/0001-apps-layout-scoped-to-js-bun.md`.

### Where tests live
Test files are never co-located with source: always under the app's `tests/` (or `apps/e2e/tests/`)
directory, mirroring the source path being tested.
- `data-engine/tests/`: pytest. DB-touching code runs against `tests/support/fake_db.py` (a scripted
  psycopg2 `RealDictCursor` double) or a monkeypatched `execute_batch`; features against the in-memory
  `RaceHistory` (`tests/support/race_history.py`). Never a real DB.
- `apps/api/tests/unit/`: `bun test`, mirrors `src/` by domain.
- `apps/api/tests/integration/`: `bun test`, real Hono `app.request()` calls against a **local** Postgres
  (`docker-compose.test.yml`; `bun run test:db:up`, config in the committed `apps/api/.env.test`). Never
  against Neon: the test setup refuses `*.neon.tech` hosts. Files seed their own fixtures and truncate after.
- `apps/web/tests/unit/`: Vitest (`node` by default, `jsdom` per-file via a docblock), MSW stubs
  `src/lib/api.ts`; page-data loaders are tested the same way.
- `apps/e2e/tests/smoke/`: Playwright against `astro dev` with the fixture API server in
  `apps/e2e/fixtures/`. Those fixtures are typed against the API's response types, so an API response
  change they don't follow fails CI's `bun run typecheck`.

Every suite, fixture and coverage gap: `docs/testing.md`.

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | Astro + Tailwind | `output: 'server'`, Cloudflare adapter |
| API | Hono | Cloudflare Workers |
| ORM | Drizzle ORM | TypeScript, schema lives in `apps/api/src/db/schema/` |
| Database | Neon PostgreSQL | |
| DB driver (Workers) | `@neondatabase/serverless` | HTTP driver: mandatory for CF Workers |
| DB driver (Python) | `psycopg2` | TCP: fine on Render |
| Data source | OpenF1 + Jolpica | live ingest, free, no login (ADR 0011); FastF1 only for the event schedule and local pre-2023 backfills |
| Python runtime | Python 3.12 (pinned via `data-engine/.python-version` + `PYTHON_VERSION` in `render.yaml`) | newer Pythons have no numpy/pandas wheels: source builds OOM Render's free tier |

---

## Critical Constraints: Read Before Writing Any Code

### 1. Cloudflare Workers cannot use TCP
Never use `pg`, `postgres`, or any npm package that uses TCP sockets in the `apps/api/` directory.
Cloudflare Workers run in V8 isolates with no TCP support.

**Always use:**
```typescript
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
```

### 2. Drizzle schema is in `apps/api/src/db/schema/`
The canonical schema lives in `apps/api/src/db/schema/`. Generated migration SQL files live in
`apps/api/drizzle/migrations/`: both the schema and its migrations are owned by `apps/api/`, since
that's also where `drizzle.config.ts` and the `drizzle-kit` CLI scripts live.
Never define schema inline in route files.

### 3. Astro data fetching is server-side only
All data fetching happens in Astro frontmatter (`---` blocks), never in `client:*` islands.
No React, Vue, or client-side JS for data fetching.

**Deliberate exception: on-demand/combinatorial UI that can't be pre-fetched:**
`GlobalSearch.tsx`, `DriverCompareTool.tsx`, and `TeamCompareTool.tsx` fetch client-side
(`client:idle`/`client:load`) because their data depends on arbitrary user input at view time
(a live search query; an arbitrary driver/team pair × year selected on demand): the combinatorial
space can't be pre-rendered into frontmatter for every possible interaction. This is the only
sanctioned exception to this rule. Any *new* client-side fetch must fit this same shape (data that
genuinely can't be known until the user interacts): if the data is knowable at request time
(e.g. a single circuit's coordinates, a fixed list), it belongs in frontmatter, passed down as a prop.

### 4. Python writes directly to Neon: never through the API
The Python ETL engine connects directly to Neon via psycopg2.
The Hono API is read-only from Neon's perspective.
Do not create write endpoints on the API for ETL use.

### 5. All ETL jobs must be idempotent
Every Python job uses `INSERT ... ON CONFLICT DO UPDATE`.
Running any job twice must produce identical results, never duplicate rows.

### 6. Stay inside the free tiers (Neon Free, Render Free, OpenF1 free)
Exceeding Neon's compute (100 CU-h/mo) or egress (5 GB/mo) suspends the DB until next month; a full
1 GB blocks every write. Render Free has 512 MB RAM and 750 h/mo (already used by the one service).
- No Workers KV: Free allows 1,000 writes a day and a crawler spent them within hours (ADR 0012, superseded).
  Repeat reads are absorbed by the edge caches below, which have no quota.
- Local dev uses `docker-compose.dev.yml` (filled by `scripts/dev_snapshot.py`), never Neon.
- Never hold a DB connection across HTTP calls (OpenF1/Jolpica/FastF1): connect late, close early.
- No new polling or wake-ups: new ETL steps ride the existing worker cycle in `auto_runner.py`.
- Whole-race data goes in one row per (race, session, driver) with arrays/JSONB, not row-per-lap.
- Heavy API routes set `Cache-Control` via `src/common/cache.ts`; `edgeCache()` serves repeats per data centre,
  and a lapsed copy when Neon errors (ADR 0005). In-progress data is cached 10 min on race weekends, 1 h between.
- Behind it, `snapshotStore()` keeps one global copy per URL in R2, held until the next write window (race
  weekend or Wednesday's F1DB import; ADR 0013). A manual write to Neon outside those needs a `SNAPSHOT_VERSION` bump.
- Site pages are kept at the edge 10 min inside a write window, else until the next window or 00:00 UTC
  (`apps/web/src/lib/pageHold.ts`): Workers Free cuts a render off at 10 ms of CPU and an uncached page takes
  15–100 ms. One copy per URL and build (no cookie in the key); a render that saw an API outage is never kept.
  A manual Neon write shows on the site early only after a redeploy (the build id is in every key).
- Each site-to-API `fetch` is a billed Worker request even on an API cache hit, so the site keeps API answers in
  its own edge cache for a page's lifetime (`apps/web/src/lib/apiCache.ts`).
- Crawlers that ignore robots.txt are blocked by a zone WAF rule before any Worker runs (`docs/deployment.md`).
- Backfills run locally in bounded chunks and check `storage_guard` first: never on Render.
- Tests never touch Neon (see "Where tests live").
Full rules and numbers: `docs/plans/intelligence-platform-roadmap.md` §1–§2.

---

## Database

**Provider:** Neon PostgreSQL
**Connection:** `DATABASE_URL` environment variable (never hardcoded)

Every table, its columns and relationships: `docs/database-schema.md`. The schema itself is
`apps/api/src/db/schema/`.

### Race Status Flow
```
conventional:
'scheduled' → 'qualifying_done' → 'completed'

sprint weekend:
'scheduled' → 'sprint_qualifying_done' → 'sprint_done' → 'qualifying_done' → 'completed'
                         ↓                      ↓                ↓
               sprint features/predictions  ingest sprint  GP features/predictions
```

---

## API (Hono: `apps/api/`)

### Module structure (NestJS-style)
```
apps/api/src/
├── common/                            # only what several modules share
│   ├── types/                         # response types, one file per domain behind an index.ts barrel
│   ├── mappers.ts, standings.ts, feature-manifest.ts, identity.ts, session-kind.ts, session-reads.ts
│   └── route.ts, cache.ts, edge-cache.ts, session.ts, constants.ts
├── config/database.ts                 # createDb(): Neon HTTP driver
├── db/schema/                         # Drizzle table definitions
├── modules/<domain>/
│   ├── <domain>.{controller,service,module}.ts
│   ├── <topic>.service.ts             # a second query service when one domain has several (racecraft, title-odds)
│   └── <topic>.helpers.ts             # pure logic used only by this module (unit-tested)
│   # races, circuits, race-events, strategy, race-story, telemetry, drivers, teams,
│   # predictions, sprint, history: plus seasons/, search/, quality/ as single files
└── main.ts                            # Entry point, route registration
```

- **service**: DB queries (Drizzle, no Hono context)
- **controller**: declares handlers with `raceRoute`/`seasonRoute`/`driverRoute`/`teamRoute` (`common/route.ts`),
  which own id/year/session validation, the 404, Cache-Control and the response envelope. Extra query params go in
  the factory's `query: [...]` (typed); a hand-written handler is wrapped in `readsQuery([...], handler)`. The edge
  cache keys on exactly those params, and a test fails if a route declares none
- **module**: Hono sub-router that wires controller handlers to routes
- **helpers**: pure functions; code moves to `common/` only once a second module needs it
- GP vs Sprint differences are data in `common/session-kind.ts` (`GP`/`SPRINT`), read through `session-reads.ts`;
  "same driver / same team" is only ever decided by `common/identity.ts` (golden cases: `docs/identity-cases.json`)
- A module with one route and a handful of query lines (`seasons`, `search`, `quality`) skips
  the split: one file holding the router + query is more readable than three near-empty ones.
- File names are kebab-case. Sub-resources keep their public URL even when they get their own
  module: `circuits` and the race sub-resources mount under `/api/races` (circuits before races' `/:id`).

### Environment Variables
| Variable | Where set |
|----------|-----------|
| `DATABASE_URL` | `wrangler secret put DATABASE_URL` |

### Response format
All endpoints return:
```typescript
{ data: T, error: null }          // success
{ data: null, error: { code: string, message: string } }  // failure
```

### Routes
Every route, its params and its response shape: `docs/api-reference.md`. The file map behind them:
`CODEMAP.md`.

No authentication. No write endpoints (ETL writes directly to DB).

### No N+1 queries
All queries use Drizzle joins. Never fetch a list then loop-query for each item.

---

## Frontend (Astro: `apps/web/`)

### Environment Variables
| Variable | Where set |
|----------|-----------|
| `PUBLIC_API_URL` | Cloudflare Pages env vars |

Every page, its layout and the data it fetches per `?tab=`: `docs/frontend.md` § Routes.

### Navigation and page tabs
- Collapsible sidebar (`components/layout/Sidebar.astro`) with two groups: Season (home, calendar, drivers,
  teams, predictions) and Explore (circuits, compare, history); the same list is the mobile drawer.
  Collapse state is a cookie so the server renders the right width.
- A page that reads a new query param adds it to `PAGE_QUERY_PARAMS` (`lib/pageQuery.ts`): the middleware 301s
  any other param away (a test checks `src` against the list)
- Each page leads with one main view; secondary views are server-rendered `?tab=` link tabs
  (`PageTabs.astro` + `lib/pageTabs.ts`), and each tab fetches only its own data.
- Pages with tabs or fallbacks load through a page-data loader (`features/<area>/load*PageData.ts`,
  like `buildPredictionPageData`) called from frontmatter; the page itself only renders.

### Component rules
- No chart libraries: use plain SVG for `LapChart.astro`
- No heavy animation libraries
- Tailwind for all styling
- `.astro` components for display; `.tsx` for interactive Shadcn islands
- `client:load`/`client:idle` only when interactivity is strictly needed: currently: `GlobalSearch`,
  `DriverCompareTool`, `TeamCompareTool` (see the client-fetch exception under Critical Constraints §3),
  `CircuitsGrid` (filters/sorts a list passed as a prop: no fetch) and `TitleWhatIf` (`client:idle` on the
  title-fight tab: re-scores the standings from picked places, all data passed as props: no fetch)

---

## Python Data Engine (`data-engine/`)

### Environment Variables
| Variable | Where set |
|----------|-----------|
| `DATABASE_URL` | Render dashboard env vars |

### Running jobs locally
```bash
cd data-engine
python -m src.main --job ingest_race --year 2025 --round 14
python -m src.main --job ingest_qualifying --year 2025 --round 14
python -m src.main --job compute_features --race_id 42
python -m src.main --job compute_pre_quali --race_id 42          # forecasts the race after 42, before its qualifying
python -m src.main --job compute_season_stats --year 2025
python -m src.main --job compute_title_odds --year 2025
python -m src.main --job ingest_race_story --year 2026 --round 9 --session Sprint
python scripts/backfill_openf1.py ingest_stints 2023 2026 [--refresh]   # local only: skips covered races
python scripts/backfill_race_story.py 2018 2022             # local only: FastF1 cache seasons
python scripts/backfill_fastf1_enrichment.py 2018 2022 [--only stints,pits,race_control,telemetry] [--refresh]  # local only
python scripts/backfill_title_odds.py 2018 2026             # local only: replays odds after every completed round
python scripts/dev_snapshot.py                              # local only: one read-only Neon dump into docker-compose.dev.yml (needs PROD_DATABASE_URL)
python scripts/neon_usage.py                                # Neon Free usage + month-end projection (control-plane API: no DB wake)
python scripts/backtest_snapshot.py                         # local only: one read-only Neon dump into docker-compose.backtest.yml
python scripts/backtest.py [--from 2018] [--to 2026] [--reference NAME] [--places] [--json]  # local snapshot only: walk-forward GP model vs baselines
python scripts/backtest_sprint.py [--train-from 2010] [--reference NAME]  # local snapshot only: walk-forward sprint models vs baselines
python scripts/fit_model_v4.py [--pre-quali]                # local snapshot only: refit src/models/gp_v4.json (or gp_v4_prequali.json) after a validated change
python scripts/backfill_all_predictions.py [--from 2018] [--skip-gp] [--skip-sprint] [--skip-pre-quali]  # local only, writes Neon: GP, sprint and pre-quali predictions, fitted per season (out-of-sample)
python scripts/backfill_podium_probability.py [--refresh]   # local only, writes Neon: podium chance from stored win probabilities
python scripts/import_f1db.py [--version vYYYY.RR.M]         # weekly GitHub Action (f1db-import.yml) or local: download, verify sha256, import
python scripts/audit_results_vs_f1db.py [--modern-plan]      # local only: read-only results check vs F1DB
python scripts/backfill_results_from_f1db.py --from 1980 --to 2017 [--apply]  # local only: ADR 0009
```

### Schedule (Render worker)
There are no Render cron jobs: `src/server.py` runs `auto_runner.run_cycle` in a loop (20 min inside a
race-weekend window, 6 h outside it, which never touches the DB). Inside the window a `WorkerMemo`
skips the DB until the next action is due. `src/weekend_pipeline.py` is the only place that maps a Race
Status to the jobs due next: the worker, the CLI auto-detect, Repair and `backfill_full.py` all read it.
Typical action timing:

**Conventional weekend:**
- **Saturday 22:00 UTC**: `ingest_qualifying` → `compute_features`
- **Sunday 18:00 UTC**: `ingest_race` → `compute_season_stats` → `compute_pre_quali` (the next race's forecast)

**Sprint weekend:**
- **Friday 22:00 UTC**: `ingest_sprint_qualifying` → `compute_sprint_features`
- **Saturday 16:00 UTC**: `ingest_sprint` → `compute_season_stats`
- **Saturday 22:00 UTC**: `ingest_qualifying` → `compute_features`
- **Sunday 18:00 UTC**: `ingest_race` → `compute_season_stats` → `compute_pre_quali` (the next race's forecast)

### Session data (OpenF1 + Jolpica)
F1 put FastF1's source behind F1TV logins (FastF1 3.9, Oct 2026) and the project pays for nothing,
so live ingest reads finished sessions from OpenF1's free tier (ADR 0011):
```python
from src.utils.openf1_session import RACE_PARTS, load_session, race_results
session = load_session(year, race_date, "R", RACE_PARTS)  # "Q", "SQ", "S", "FP2"...; found by races.race_date
rows = race_results(session, fetch_classification(year, round_num))  # Jolpica: grid, status, points
```
`openf1_session.py` keeps the row shapes the old FastF1 helpers produced. FastF1 (pinned 3.5.3) is
still used for `get_event_schedule`, the pre-2018 `_legacy` jobs (Ergast results, still free) and the
local 2018–2022 backfills, which only work from a cache.

### Error handling
Jobs exit with code 1 on failure (Render marks job failed for manual retrigger).
Never use `sleep()` inside jobs for waiting on data: retry on the next worker cycle instead. The
only sanctioned waits are `openf1_client`'s request pacing/backoff (see `docs/adr/0004`).
A job whose source hasn't published the session yet raises `SessionNotReady` (`utils/session_records.py`): the
worker retries only that (plus a spent OpenF1 budget and network errors); any other exception is a real failure.
A new job is one entry in `src/jobs/registry.py`: the CLI and the pipeline's step table both read it.
Use structured logging: `{"job": "ingest_race", "round": 14, "status": "failed", "error": "..."}`.

---

## Drizzle ORM (`apps/api/drizzle/`)

### Running migrations
```bash
cd apps/api
bun run db:generate   # generate SQL from schema changes -> apps/api/drizzle/migrations/
bun run db:migrate    # apply via migration files (Neon is migrate-tracked: never db:push it)
```

### Schema conventions
- All tables use `SERIAL` primary keys
- All timestamps are `TIMESTAMPTZ` with `DEFAULT now()`
- Lap times stored as `INTEGER` milliseconds (never float)
- Sprint feature scores stored as `NUMERIC(6,5)` (0.00000 to 1.00000); GP features as one `features` JSONB
- Unique constraints on all natural keys (e.g. `UNIQUE(race_id, driver_id)`)

---

## Prediction Model

Two models: **GP** (`weighted-v4`, a fitted conditional logit over 7 features) and **Sprint** (`sprint-v3`:
the GP's weights on the sprint's own grid). Feature table, importances, static vs computed inputs and
backtest numbers: `docs/prediction-model.md`.

Rules that must not bend:
- `utils/gp_model_v4.py` is the only path to a GP Prediction (`training_races` → `fit(before=)` → `predict`),
  shared by `compute_features`, the backfill, the fit script and the backtest. `compute_features` writes
  features, probabilities and the predicted winner in one transaction.
- Fitted weights live in `data-engine/src/models/gp_v4.json`, written by `scripts/fit_model_v4.py` from the
  local backtest snapshot and committed. Refit only after `scripts/backtest.py` validates the change;
  `scripts/backtest_sprint.py` picks the sprint model.
- Every feature must be computable from races before the predicted one: the backtest replays history, and
  a feature that peeks ahead makes it lie (ADR 0010). A sprint's own result is never a feature.
- Importances come from `docs/feature-weights.json` and are mirrored into the API's
  `common/feature-manifest.ts`, served with every Prediction; the web keeps no copy. `test_weights.py` and
  `feature-manifest.test.ts` check both.
- Sprint rows use the GP's shape (`features` JSONB) and the GP manifest; no podium chance for sprints.
- Before qualifying, `compute_pre_quali` forecasts the next race over `previous_lineup` with its own fit
  (`gp_v4_prequali.json`); a season opener gets none.
- Podium chance: the Henery exponent `PODIUM_DISCOUNT = 0.8` in `utils/finishing_order.py`, GP only.
- `circuits.overtake_rate` is seeded once, never changes; `circuits.sc_probability` is recomputed after
  every race ingest.

---

## Development Setup

### Root (apps/api + apps/web)
```bash
bun run install:all  # bun install in both apps/api and apps/web
bun run dev           # runs apps/api (wrangler dev) + apps/web (astro dev) concurrently
bun run build          # apps/web production build
```
Plain orchestration scripts: no Bun workspaces. `data-engine/` isn't part of `bun run dev` since its
jobs run once and exit rather than being a long-running dev server; invoke it directly (below).

### API
```bash
cd apps/api
bun install
bun run dev          # local dev via wrangler dev
bun run deploy       # deploy to CF Workers
```

### Frontend (apps/web/)
```bash
cd apps/web
bun install
bun run dev          # local Astro dev server on :4321
bun run build        # production build
```

### Data Engine
```bash
cd data-engine
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in DATABASE_URL
```

Applying the DB schema is covered under [Drizzle ORM](#drizzle-orm-appsapidrizzle) above: it's part of the `apps/api/` setup, not a separate package.

---

## Git / Commits

- **Never commit without being explicitly asked.** Do not auto-commit after fixes, refactors, or any other changes: always wait for the user to say "commit" or invoke the commit skill.
- **Always read the `commit` skill first** (`.claude/skills/commit/`, mirrored at `.agents/skills/commit/`). It contains the required format and rules; follow it exactly.
- Never deploy to Cloudflare from the CLI. Push to GitHub and let the Cloudflare integration deploy automatically.

---

## Code Style

- TypeScript strict mode everywhere in `apps/api/` and `apps/web/`
- No `any` types: define proper types in the app's `types/` folder (one file per domain, imported via its barrel)
- Python: type hints on all function signatures
- No comments explaining what code does: name things clearly instead
- Only comment WHY when it's non-obvious (a hidden constraint, a workaround)
- Comments must be at most 2 lines. Only go longer if it's genuinely unavoidable: that should be rare
- No console.log in production code: use structured logging patterns
- ESLint `max-lines` budgets (CI + pre-commit): web pages 300 / components 250 / lib 200; API controller 80 /
  module 50 / service+helpers 200 / common 150. Over budget: extract, never raise the limit
