# F1 Intelligence Platform: Claude Code Guide

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
│   └── e2e/       # Playwright smoke tests for apps/web: own package.json + playwright.config.ts
└── data-engine/   # Python ETL batch jobs on Render
```
`apps/` is a JS/Bun-only convention: root `package.json` orchestrates `apps/api`, `apps/web`, and
`apps/e2e` via plain `cd`-based scripts (no Bun workspaces). `data-engine/` stays outside `apps/`:
it's Python, and its jobs run once and exit rather than being a long-running dev server. See
`docs/adr/0001-apps-layout-scoped-to-js-bun.md`.

### Where tests live
- `data-engine/tests/`: pytest. Pure functions (`math_utils.py`, pure `feature_helpers.py` helpers, model
  `WEIGHTS` invariants) are tested directly. DB-touching functions (`compute_luck_score`, `same_person_rows`,
  `compute_team_circuit_perf`, `season_drivers`) are tested via `tests/support/fake_db.py`: a scripted
  `FakeCursor`/`FakeConnection` double shaped like psycopg2's `RealDictCursor`, no real DB. `ingest_runner.py`'s
  two shared runners (`run_ingest_job` for race/sprint, `run_qualifying_ingest_job` for qualifying/sprint-qualifying)
  are tested the same way. `upsert.py` and the two prediction jobs route their writes through
  `psycopg2.extras.execute_batch`, which renders SQL via a C extension that needs a real connection
  even just to quote identifiers: so their tests monkeypatch `execute_batch` itself and assert on
  the params it receives, the same pattern `test_ingest_runner.py` already uses for its own
  `execute_batch` call, rather than extending `FakeCursor` to fake SQL rendering.
  `openf1_session` (OpenF1 + Jolpica → ingest rows) runs against recorded Bahrain 2026 responses
  (`tests/fixtures/openf1/`, `tests/fixtures/jolpica/`), checked against what FastF1 ingested.
  `weekend_pipeline` (Race Status → due jobs) and `enrichment_coverage` are tested pure; code that runs
  chains is tested by swapping entries in `weekend_pipeline.JOBS`, never by patching each job module.
  The sprint job (`compute_sprint_features`, sprint-v2) is pinned end to end in `test_compute_sprint_features.py`; the GP job
  (`compute_features`, weighted-v4) and its pure features run against an in-memory `RaceHistory`
  (`tests/support/race_history.py`) in `test_compute_features.py` / `test_gp_features_v4.py`.
- `apps/api/tests/unit/`: `bun test`, mirrors `src/` by domain (e.g. `tests/unit/common/mappers.test.ts`
  tests `src/common/mappers.ts`). Covers the shared `src/common/` mapper/aggregation layer.
- `apps/api/tests/integration/`: `bun test`, real Hono `app.request()` calls against a **local** Postgres
  (`docker-compose.test.yml` behind a Neon HTTP proxy; `bun run test:db:up`, config in the committed
  `apps/api/.env.test`). Never against Neon: the test setup refuses `*.neon.tech` hosts. Seeds its own
  fixtures per file via `tests/support/factories/` and truncates after (`tests/support/db/test-db.ts`).
  Covers every module except `quality` (dev-only): `races`, race events/story/strategy/telemetry, `drivers`, `teams`,
  `seasons`, `search`, `predictions`, `sprint`, `history`: plus the `edgeCache` middleware, the route factories
  (`integration/route/`) and per-kind GP/sprint reads (`integration/session-kind/`).
- `apps/web/tests/unit/`: Vitest. Pure logic (`compareStats.ts`, compare configs, `lib/` lookups) runs under the default `node`
  environment. Hook/component tests (`useCompareController`, `useGlobalSearch`, `GlobalSearch`) opt into `jsdom`
  per-file via a `// @vitest-environment jsdom` docblock, use Testing Library, and mock `src/lib/api.ts`'s
  endpoints with MSW (`tests/support/msw/`). Page-data loaders (`load*PageData`) run in the `node`
  environment with MSW stubbing their routes (`tests/support/msw/routes.ts`). `.astro` component rendering
  is still not covered.
- `apps/e2e/tests/smoke/`: Playwright, drives a real browser against `astro dev` with a fixture API server
  (`apps/e2e/fixtures/`) standing in for `apps/api`. Covers the hub, races, circuits, drivers, teams,
  compare, predictions and History pages and the global search palette. Playwright reuses an already-running
  `astro dev` on :4321 (your real-data dev server), set `E2E_WEB_PORT`/`E2E_API_PORT` to run against fixtures
  while dev servers are up. Fixtures in `apps/e2e/fixtures/data.ts` are typed against the API's response types
  (`apps/web/src/types` re-exports `apps/api/src/common/types` type-only) and CI runs `bun run typecheck` on them,
  so an API response change that the fixtures don't follow fails the build. The fixture server sends CORS
  headers because `GlobalSearch`/`DriverCompareTool`/`TeamCompareTool` fetch client-side (see the data-fetching
  exception below): that's a real cross-origin browser request, unlike every other route which is only ever
  hit server-side from Astro frontmatter.

Test files are never co-located with source: always under the app's `tests/` (or `apps/e2e/tests/`) directory,
mirroring the source path being tested.

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
- Never hold a DB connection across HTTP calls (OpenF1/Jolpica/FastF1): connect late, close early.
- No new polling or wake-ups: new ETL steps ride the existing worker cycle in `auto_runner.py`.
- Whole-race data goes in one row per (race, session, driver) with arrays/JSONB, not row-per-lap.
- Heavy API routes set `Cache-Control` via `src/common/cache.ts`; `edgeCache()` serves repeats.
- Backfills run locally in bounded chunks and check `storage_guard` first: never on Render.
- Tests never touch Neon (see "Where tests live").
Full rules and numbers: `docs/plans/intelligence-platform-roadmap.md` §1–§2.

---

## Database

**Provider:** Neon PostgreSQL
**Connection:** `DATABASE_URL` environment variable (never hardcoded)

### Key Tables
- `circuits`: static track data, seeded once (includes `overtake_rate`)
- `seasons`: one row per year
- `races`: one per race event; `status` + `event_format` control ETL flow; includes sprint condition columns and sprint dates
- `teams` / `drivers`: season-scoped (change year to year)
- `qualifying_results` / `race_results` / `lap_times`: raw GP ingested data
- `sprint_results`: sprint finish data + SQ1/SQ2/SQ3 qualifying times
- `sprint_lap_times`: per-lap sprint data (mirrors `lap_times` structure)
- `race_control_messages` / `race_overtakes` / `team_radio_clips`: race events tagged `session_type` `race`/`sprint`; race control 2018+ (OpenF1 from 2023, FastF1 before), overtakes and radio OpenF1-only (2023+)
- `race_stints` / `race_pit_stops`: tyre stints and pit stops (2018+: OpenF1 from 2023, FastF1 before), per `session_type`; pre-2023 stops have pit-lane time only
- `title_odds_drivers` / `title_odds_teams`: Monte Carlo championship odds, one row per contender per round
- `race_lap_traces` / `race_battles` / `race_weather_traces`: race story from full laps (2018+: OpenF1 live, FastF1 before 2023): per-driver int[] arrays, battles, per-minute weather
- `qualifying_lap_telemetry`: each driver's fastest Q/SQ lap (2018+: OpenF1 from 2023, FastF1 before), resampled every 10 m into one JSONB row (~11 KB)
- `history_drivers` / `history_constructors` / `history_constructor_seasons` / `history_constructor_lineage` / `f1db_imports`: all-time history from F1DB (CC-BY-4.0, credit it wherever shown); joined to core drivers by `match_key` (`normalize_person_name`) and to teams via `f1dbConstructorId(team_key)`
- `driver_season_stats` / `team_season_stats`: aggregated after each race (includes sprint aggregates)
- `driver_prediction_features`: weighted-v4 features per driver per GP (`features` JSONB: value + contribution)
- `race_predictions`: one predicted GP winner per race
- `driver_sprint_features`: 8 sprint-specific feature scores per driver per sprint weekend
- `sprint_predictions`: one predicted sprint winner per sprint weekend

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
  which own id/year/session validation, the 404, Cache-Control and the response envelope
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

### Route structure
```
GET /api/health

GET /api/races?year=N&status=S
GET /api/races/circuits
GET /api/races/circuit/:circuitKey
GET /api/races/circuit/:circuitKey/telemetry
GET /api/races/:id
GET /api/races/:id/race-control?session=race|sprint
GET /api/races/:id/overtakes?session=race|sprint
GET /api/races/:id/team-radio?session=race|sprint
GET /api/races/:id/strategy?session=race|sprint
GET /api/races/:id/race-story?session=race|sprint
GET /api/races/:id/telemetry?session=Q|SQ&a=CODE&b=CODE

GET /api/drivers?year=N&team_id=N
GET /api/drivers/standings?year=N
GET /api/drivers/racecraft?year=N
GET /api/drivers/:id/teammate-battle?year=N
GET /api/drivers/:id/history
GET /api/drivers/:id/career
GET /api/drivers/:id?year=N

GET /api/teams?year=N
GET /api/teams/standings?year=N
GET /api/teams/pit-stops?year=N
GET /api/teams/:id/pit-stops?year=N
GET /api/teams/:id/history
GET /api/teams/:id/career
GET /api/teams/:id?year=N

GET /api/predictions/model-info
GET /api/predictions/accuracy
GET /api/predictions/upcoming
GET /api/predictions/history?year=N
GET /api/predictions/standings?year=N
GET /api/predictions/title-odds?year=N
GET /api/predictions/race/:race_id
GET /api/predictions/race/:race_id/friday-pace

GET /api/sprint/upcoming
GET /api/sprint/race/:race_id
GET /api/sprint/race/:race_id/detail

GET /api/seasons

GET /api/history/records
GET /api/history/milestones
GET /api/history/lineages
GET /api/history/on-this-day?date=MM-DD
GET /api/races/:id/recap

GET /api/search

GET /api/quality?year=N            # dev-only data-quality report
```

No authentication. No write endpoints (ETL writes directly to DB).

### No N+1 queries
All queries use Drizzle joins. Never fetch a list then loop-query for each item.

---

## Frontend (Astro: `apps/web/`)

### Environment Variables
| Variable | Where set |
|----------|-----------|
| `PUBLIC_API_URL` | Cloudflare Pages env vars |

### Pages
| Route | Layout | Data source |
|-------|--------|------------|
| `/` | BaseLayout | Season progress strip + three fixed blocks: next race (schedule, circuit, model top 3), last race (podium + Recap), championship top 5 with title odds |
| `/prediction` | BaseLayout | `GET /api/predictions/upcoming` (+ sprint, model standings); `?tab=scorecard` fetches `predictions/history` + `accuracy` |
| `/prediction/[id]` · `/prediction/sprint/[id]` | BaseLayout | `GET /api/predictions/race/:id` (+ friday pace) · `GET /api/sprint/race/:id` |
| `/races` | BaseLayout | `GET /api/races?year=N` |
| `/races/[id]` · `/races/[id]/sprint` | BaseLayout | `GET /api/races/:id` (+ strategy, race events per tab) · `GET /api/sprint/race/:id/detail` |
| `/races/[id]/race-story` | BaseLayout | `GET /api/races/:id/race-story` (`?session=sprint` for the sprint) |
| `/races/[id]/telemetry` | BaseLayout | `GET /api/races/:id/telemetry`: drivers picked with a plain GET form, so no client fetch |
| `/circuits` · `/circuits/[key]` | BaseLayout | `GET /api/races/circuits` · `GET /api/races/circuit/:key` (+ `/telemetry` tab) |
| `/drivers` · `/teams` | BaseLayout | standings; `?tab=title-fight`/`title-odds` fetch title odds, `racecraft`/`pit-crews` their own route |
| `/drivers/[id]` | BaseLayout | `GET /api/drivers/:id` (+ teammate battle, career, model tabs) |
| `/teams/[id]` | BaseLayout | `GET /api/teams/:id` (+ pit crew, history tabs) |
| `/compare/drivers` · `/compare/teams` | BaseLayout | season lists in frontmatter; the compare island fetches the pair client-side (§3 exception) |
| `/history` | BaseLayout | `GET /api/history/records`; `?tab=milestones`/`on-this-day` (`&date=MM-DD`)/`lineage` each fetch their own route |

### Navigation and page tabs
- Collapsible sidebar (`components/layout/Sidebar.astro`) with two groups: Season (home, calendar, drivers,
  teams, predictions) and Explore (circuits, compare, history); the same list is the mobile drawer.
  Collapse state is a cookie so the server renders the right width.
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
  `DriverCompareTool`, `TeamCompareTool` (see the client-fetch exception under Critical Constraints §3), and
  `CircuitsGrid` (filters/sorts a list passed as a prop: no fetch)

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
python -m src.main --job compute_season_stats --year 2025
python -m src.main --job compute_title_odds --year 2025
python -m src.main --job ingest_race_story --year 2026 --round 9 --session Sprint
python scripts/backfill_openf1.py ingest_stints 2023 2026 [--refresh]   # local only: skips covered races
python scripts/backfill_race_story.py 2018 2022             # local only: FastF1 cache seasons
python scripts/backfill_fastf1_enrichment.py 2018 2022 [--only stints,pits,race_control,telemetry] [--refresh]  # local only
python scripts/backfill_title_odds.py 2018 2026             # local only: replays odds after every completed round
python scripts/backtest_snapshot.py                         # local only: one read-only Neon dump into docker-compose.backtest.yml
python scripts/backtest.py [--from 2018] [--to 2026] [--reference NAME] [--json]  # local snapshot only: walk-forward GP model vs baselines
python scripts/fit_model_v4.py                              # local snapshot only: refit src/models/gp_v4.json after a validated change
python scripts/backfill_all_predictions.py [--from 2018]    # local only, writes Neon: regenerate predictions (GP fitted per season, out-of-sample)
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
- **Sunday 18:00 UTC**: `ingest_race` → `compute_season_stats`

**Sprint weekend:**
- **Friday 22:00 UTC**: `ingest_sprint_qualifying` → `compute_sprint_features`
- **Saturday 16:00 UTC**: `ingest_sprint` → `compute_season_stats`
- **Saturday 22:00 UTC**: `ingest_qualifying` → `compute_features`
- **Sunday 18:00 UTC**: `ingest_race` → `compute_season_stats`

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
bun run db:push       # apply to Neon (dev)
bun run db:migrate    # apply via migration files (prod)
```

### Schema conventions
- All tables use `SERIAL` primary keys
- All timestamps are `TIMESTAMPTZ` with `DEFAULT now()`
- Lap times stored as `INTEGER` milliseconds (never float)
- Sprint feature scores stored as `NUMERIC(6,5)` (0.00000 to 1.00000); GP features as one `features` JSONB
- Unique constraints on all natural keys (e.g. `UNIQUE(race_id, driver_id)`)

---

## Prediction Model

Two models: **GP model** (`weighted-v4`, fitted, 7 features) and **Sprint model** (`sprint-v2`, hand
weights, 8 features). Full detail and backtest numbers in `docs/prediction-model.md`; why: ADR 0010.

### GP model (weighted-v4)
A conditional logit: P(win) = softmax over the field of Σ weight × standardized feature, with the weights
fitted to every GP since 2010 (`utils/conditional_logit.py`). Features (`utils/gp_features_v4.py`) are in
real units and only use races before the one predicted:

| Feature | Importance | Origin |
|---------|-----------|--------|
| Grid Slot | 20% | `qualifying_results.grid_position`, as −log(grid) |
| Driver Form | 18% | decayed points per race, last 12 races across seasons (by person) |
| Team Race Pace | 18% | decayed gap to the fastest clean race-lap median (`lap_times`, 2018+) |
| Grid × Hard-to-Pass Track | 17% | grid × (1 − `circuits.overtake_rate`) |
| Team Qualifying Pace | 12% | decayed best qualifying gap to pole (by outfit) |
| Qualifying Pace | 11% | this weekend's gap to the fastest time in the deepest session reached |
| Teammate Edge | 4% | decayed qualifying gap to the team-mate |

- Fitted weights live in `data-engine/src/models/gp_v4.json`, written by `scripts/fit_model_v4.py` from the
  local backtest snapshot and committed. Refit only after `scripts/backtest.py` validates the change.
- The importances above are each feature's share of |weight per SD|; `fit_model_v4.py` writes them to
  `docs/feature-weights.json`, then mirror them into `apps/web` `predictionMath.ts` `FEATURE_META`.
  `test_weights.py`, `predictionMath.test.ts` and the API's `feature-manifest.test.ts` check every copy.
- Each row stores `features` JSONB (feature → value + contribution); `raw_weighted_score` is the summed
  contributions and the probability is a plain softmax (T = 1). There is no hand-set temperature.
- `utils/gp_model_v4.py` is the only path to a GP Prediction: `training_races` → `fit(before=)` → `predict`, used by
  `compute_features`, the backfill, the fit script and the backtest. `compute_features` writes features, probabilities
  and the predicted winner in one transaction, and skips races inside the committed fit (`trained_on.to_date`).
- Every feature must be computable from races before the predicted one: the backtest replays history and
  a feature that peeks ahead makes it lie (the v3 numbers did, see ADR 0010).

### Sprint Weights (sprint-v2)
| Feature | Weight | Origin |
|---------|--------|--------|
| Car Performance | 25% | Race results → `team_season_stats.car_performance_score` |
| Circuit-Adj. Starting Position | 25% | SQ grid × static circuit overtake rate |
| Short Run Pace | 10% | SQ1/SQ2/SQ3 times → fallback: main qualifying |
| Driver Rating | 10% | Sprint points / sprint races; fallback: main race rating |
| Weather Impact | 8% | Sprint weather → historical wet-race finish avg |
| Win Rate | 8% | Sprint wins; fallback: main race win rate |
| Luck Factor | 8% | GP finish position vs expected, last 5 races |
| SQ vs Teammate | 6% | SQ times → weighted teammate gap, last 5 sprint weekends |

### Static / Hardcoded inputs
- `circuits.overtake_rate`: seeded once per circuit, never changes
- `circuits.sc_probability`: **not static**: recomputed after every race ingest from `races.safety_car_laps`
  (`ingest_race._recompute_circuit_sc_probability`)
- Sprint softmax temperature T=0.3: `SPRINT_SOFTMAX_TEMPERATURE` in `data-engine/src/utils/feature_manifest.py`
  (applied by `compute_sprint_features.py`) and `apps/web/src/lib/f1/predictionMath.ts`. It applies to the
  hand-weighted sprint model only.
- Sprint weights: `SPRINT_FEATURES` in `feature_manifest.py`, re-exported as `WEIGHTS` by
  `compute_sprint_features.py`, which also writes the probabilities and the predicted winner in one
  transaction; weights, labels and the temperature are checked
  against `docs/feature-weights.json` by the same three tests.

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

- **Never commit without being explicitly asked.** Do not auto-commit after fixes, refactors, or any other changes: always wait for the user to say "commit" or invoke `/commit`.
- **Always read `.claude/skills/commit/` before committing.** The skill contains the required format and rules; follow it exactly.
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
