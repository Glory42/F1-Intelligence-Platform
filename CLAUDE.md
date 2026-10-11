# F1 Intelligence Platform — Claude Code Guide

## Project Overview
F1 analysis platform (brand: `SITE_NAME` in `apps/web/src/lib/site.ts`). Uses historical + current F1
data (FastF1, OpenF1) for race analysis and to predict race winners with a weighted feature scoring
system. Roadmap and free-tier budget rules: `docs/plans/intelligence-platform-roadmap.md`.

## Monorepo Layout
```
f1-intelligence/
├── apps/
│   ├── web/       # Astro SSR on Cloudflare Pages
│   ├── api/       # Hono on Cloudflare Workers (NestJS-style modules)
│   │              # Also owns the Drizzle schema (src/db/schema/) and migrations (drizzle/migrations/)
│   └── e2e/       # Playwright smoke tests for apps/web — own package.json + playwright.config.ts
└── data-engine/   # Python ETL batch jobs on Render
```
`apps/` is a JS/Bun-only convention — root `package.json` orchestrates `apps/api`, `apps/web`, and
`apps/e2e` via plain `cd`-based scripts (no Bun workspaces). `data-engine/` stays outside `apps/`:
it's Python, and its jobs run once and exit rather than being a long-running dev server. See
`docs/adr/0001-apps-layout-scoped-to-js-bun.md`.

### Where tests live
- `data-engine/tests/` — pytest. Pure functions (`math_utils.py`, pure `feature_helpers.py` helpers, model
  `WEIGHTS` invariants) are tested directly. DB-touching functions (`compute_weather_score`, `compute_luck_score`,
  `build_feature_context`, `build_driver_code_map`) are tested via `tests/support/fake_db.py` — a scripted
  `FakeCursor`/`FakeConnection` double shaped like psycopg2's `RealDictCursor`, no real DB. `ingest_runner.py`'s
  two shared runners (`run_ingest_job` for race/sprint, `run_qualifying_ingest_job` for qualifying/sprint-qualifying)
  are tested the same way. `upsert.py` and `prediction_runner.py` route their writes through
  `psycopg2.extras.execute_batch`, which renders SQL via a C extension that needs a real connection
  even just to quote identifiers — so their tests monkeypatch `execute_batch` itself and assert on
  the params it receives, the same pattern `test_ingest_runner.py` already uses for its own
  `execute_batch` call, rather than extending `FakeCursor` to fake SQL rendering.
- `apps/api/tests/unit/` — `bun test`, mirrors `src/` by domain (e.g. `tests/unit/common/mappers.test.ts`
  tests `src/common/mappers.ts`). Covers the shared `src/common/` mapper/aggregation layer.
- `apps/api/tests/integration/` — `bun test`, real Hono `app.request()` calls against a **local** Postgres
  (`docker-compose.test.yml` behind a Neon HTTP proxy; `bun run test:db:up`, config in the committed
  `apps/api/.env.test`). Never against Neon — the test setup refuses `*.neon.tech` hosts. Seeds its own
  fixtures per file via `tests/support/factories/` and truncates after (`tests/support/db/test-db.ts`).
  Covers every module except `quality` (dev-only) — `races`, race events/story/strategy/telemetry, `drivers`, `teams`,
  `seasons`, `search`, `predictions`, `sprint`, `history` — plus the `edgeCache` middleware.
- `apps/web/tests/unit/` — Vitest. Pure logic (`compareStats.ts`, `lib/` lookups) runs under the default `node`
  environment. Hook/component tests (`useCompareController`, `useGlobalSearch`, `GlobalSearch`) opt into `jsdom`
  per-file via a `// @vitest-environment jsdom` docblock, use Testing Library, and mock `src/lib/api.ts`'s
  endpoints with MSW (`tests/support/msw/`). `.astro` component rendering is still not covered.
- `apps/e2e/tests/smoke/` — Playwright, drives a real browser against `astro dev` with a fixture API server
  (`apps/e2e/fixtures/`) standing in for `apps/api`. Covers the hub, races, circuits, drivers, teams,
  compare, predictions and History pages and the global search palette. Playwright reuses an already-running
  `astro dev` on :4321 (your real-data dev server) — set `E2E_WEB_PORT`/`E2E_API_PORT` to run against fixtures
  while dev servers are up. The fixture server sends CORS
  headers because `GlobalSearch`/`DriverCompareTool`/`TeamCompareTool` fetch client-side (see the data-fetching
  exception below) — that's a real cross-origin browser request, unlike every other route which is only ever
  hit server-side from Astro frontmatter.

Test files are never co-located with source — always under the app's `tests/` (or `apps/e2e/tests/`) directory,
mirroring the source path being tested.

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | Astro + Tailwind | `output: 'server'`, Cloudflare adapter |
| API | Hono | Cloudflare Workers |
| ORM | Drizzle ORM | TypeScript, schema lives in `apps/api/src/db/schema/` |
| Database | Neon PostgreSQL | |
| DB driver (Workers) | `@neondatabase/serverless` | HTTP driver — mandatory for CF Workers |
| DB driver (Python) | `psycopg2` | TCP — fine on Render |
| Data source | FastF1 | Python library for F1 session data |
| Python runtime | Python 3.12 (pinned via `data-engine/.python-version` + `PYTHON_VERSION` in `render.yaml`) | newer Pythons have no numpy/pandas wheels — source builds OOM Render's free tier |

---

## Critical Constraints — Read Before Writing Any Code

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
`apps/api/drizzle/migrations/` — both the schema and its migrations are owned by `apps/api/`, since
that's also where `drizzle.config.ts` and the `drizzle-kit` CLI scripts live.
Never define schema inline in route files.

### 3. Astro data fetching is server-side only
All data fetching happens in Astro frontmatter (`---` blocks), never in `client:*` islands.
No React, Vue, or client-side JS for data fetching.

**Deliberate exception — on-demand/combinatorial UI that can't be pre-fetched:**
`GlobalSearch.tsx`, `DriverCompareTool.tsx`, and `TeamCompareTool.tsx` fetch client-side
(`client:idle`/`client:load`) because their data depends on arbitrary user input at view time
(a live search query; an arbitrary driver/team pair × year selected on demand) — the combinatorial
space can't be pre-rendered into frontmatter for every possible interaction. This is the only
sanctioned exception to this rule. Any *new* client-side fetch must fit this same shape (data that
genuinely can't be known until the user interacts) — if the data is knowable at request time
(e.g. a single circuit's coordinates, a fixed list), it belongs in frontmatter, passed down as a prop.

### 4. Python writes directly to Neon — never through the API
The Python ETL engine connects directly to Neon via psycopg2.
The Hono API is read-only from Neon's perspective.
Do not create write endpoints on the API for ETL use.

### 5. All ETL jobs must be idempotent
Every Python job uses `INSERT ... ON CONFLICT DO UPDATE`.
Running any job twice must produce identical results, never duplicate rows.

### 6. Stay inside the free tiers (Neon Free, Render Free, OpenF1 free)
Exceeding Neon's compute (100 CU-h/mo) or egress (5 GB/mo) suspends the DB until next month; a full
1 GB blocks every write. Render Free has 512 MB RAM and 750 h/mo (already used by the one service).
- Never hold a DB connection across HTTP calls (FastF1/OpenF1) — connect late, close early.
- No new polling or wake-ups: new ETL steps ride the existing worker cycle in `auto_runner.py`.
- Whole-race data goes in one row per (race, session, driver) with arrays/JSONB, not row-per-lap.
- Heavy API routes set `Cache-Control` via `src/common/cache.ts`; `edgeCache()` serves repeats.
- Backfills run locally in bounded chunks and check `storage_guard` first — never on Render.
- Tests never touch Neon (see "Where tests live").
Full rules and numbers: `docs/plans/intelligence-platform-roadmap.md` §1–§2.

---

## Database

**Provider:** Neon PostgreSQL
**Connection:** `DATABASE_URL` environment variable (never hardcoded)

### Key Tables
- `circuits` — static track data, seeded once (includes `overtake_rate`)
- `seasons` — one row per year
- `races` — one per race event; `status` + `event_format` control ETL flow; includes sprint condition columns and sprint dates
- `teams` / `drivers` — season-scoped (change year to year)
- `qualifying_results` / `race_results` / `lap_times` — raw GP ingested data
- `sprint_results` — sprint finish data + SQ1/SQ2/SQ3 qualifying times
- `sprint_lap_times` — per-lap sprint data (mirrors `lap_times` structure)
- `race_control_messages` / `race_overtakes` / `team_radio_clips` — OpenF1 race events (2023+), tagged `session_type` `race`/`sprint`
- `race_stints` / `race_pit_stops` — OpenF1 tyre stints and pit stops (2023+), per `session_type`
- `title_odds_drivers` / `title_odds_teams` — Monte Carlo championship odds, one row per contender per round
- `race_lap_traces` / `race_battles` / `race_weather_traces` — race story from FastF1 full laps (2018+): per-driver int[] arrays, battles, per-minute weather
- `qualifying_lap_telemetry` — each driver's fastest Q/SQ lap from OpenF1 (2023+), resampled every 10 m into one JSONB row (~11 KB)
- `history_drivers` / `history_constructors` / `history_constructor_seasons` / `history_constructor_lineage` / `f1db_imports` — all-time history from F1DB (CC-BY-4.0, credit it wherever shown); joined to core drivers by `match_key` (`normalize_person_name`) and to teams via `f1dbConstructorId(team_key)`
- `driver_season_stats` / `team_season_stats` — aggregated after each race (includes sprint aggregates)
- `driver_prediction_features` — 12 normalized feature scores per driver per GP
- `race_predictions` — one predicted GP winner per race
- `driver_sprint_features` — 8 sprint-specific feature scores per driver per sprint weekend
- `sprint_predictions` — one predicted sprint winner per sprint weekend

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

## API (Hono — `apps/api/`)

### Module structure (NestJS-style)
```
apps/api/src/
├── common/                            # only what several modules share
│   ├── types/                         # response types, one file per domain behind an index.ts barrel
│   ├── mappers.ts, standings.ts, prediction-response.ts, feature-manifest.ts, driver-identity.ts
│   └── cache.ts, edge-cache.ts, race-status.ts, session.ts, constants.ts
├── config/database.ts                 # createDb() — Neon HTTP driver
├── db/schema/                         # Drizzle table definitions
├── modules/<domain>/
│   ├── <domain>.{controller,service,module}.ts
│   ├── <topic>.service.ts             # a second query service when one domain has several (racecraft, title-odds)
│   └── <topic>.helpers.ts             # pure logic used only by this module (unit-tested)
│   # races, circuits, race-events, strategy, race-story, telemetry, drivers, teams,
│   # predictions, sprint, history — plus seasons/, search/, quality/ as single files
└── main.ts                            # Entry point, route registration
```

- **service** — DB queries (Drizzle, no Hono context)
- **controller** — parses Hono context, calls service, returns JSON
- **module** — Hono sub-router that wires controller handlers to routes
- **helpers** — pure functions; code moves to `common/` only once a second module needs it
- A module with one route and a handful of query lines (`seasons`, `search`, `quality`) skips
  the split — one file holding the router + query is more readable than three near-empty ones.
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

## Frontend (Astro — `apps/web/`)

### Environment Variables
| Variable | Where set |
|----------|-----------|
| `PUBLIC_API_URL` | Cloudflare Pages env vars |

### Pages
| Route | Layout | Data source |
|-------|--------|------------|
| `/` | BaseLayout | Season progress strip + three fixed blocks: next race (schedule, circuit, model top 3), last race (podium + Recap), championship top 5 with title odds |
| `/prediction` | BaseLayout | `GET /api/predictions/upcoming` |
| `/races/[id]` | BaseLayout | `GET /api/races/:id` (+ strategy, race events) |
| `/races/[id]/race-story` | BaseLayout | `GET /api/races/:id/race-story` (`?session=sprint` for the sprint) |
| `/races/[id]/telemetry` | BaseLayout | `GET /api/races/:id/telemetry` — drivers picked with a plain GET form, so no client fetch |
| `/history` | BaseLayout | `GET /api/history/records`; `?tab=milestones`/`on-this-day` (`&date=MM-DD`)/`lineage` each fetch their own route |
| `/drivers/[id]` | BaseLayout | `GET /api/drivers/:id` |
| `/teams/[id]` | BaseLayout | `GET /api/teams/:id` |

### Navigation and page tabs
- Collapsible sidebar (`components/layout/Sidebar.astro`) with two groups — Season (home, calendar, drivers,
  teams, predictions) and Explore (circuits, compare, history); the same list is the mobile drawer.
  Collapse state is a cookie so the server renders the right width.
- Each page leads with one main view; secondary views are server-rendered `?tab=` link tabs
  (`PageTabs.astro` + `lib/pageTabs.ts`), and each tab fetches only its own data.

### Component rules
- No chart libraries — use plain SVG for `LapChart.astro`
- No heavy animation libraries
- Tailwind for all styling
- `.astro` components for display; `.tsx` for interactive Shadcn islands
- `client:load`/`client:idle` only when interactivity is strictly needed — currently: `GlobalSearch`,
  `DriverCompareTool`, `TeamCompareTool` (see the client-fetch exception under Critical Constraints §3), and
  `CircuitsGrid` (filters/sorts a list passed as a prop — no fetch)

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
python -m src.main --job compute_predictions --race_id 42
python -m src.main --job compute_season_stats --year 2025
python -m src.main --job compute_title_odds --year 2025
python scripts/backfill_openf1.py ingest_stints 2023 2026   # local only
python scripts/backfill_race_story.py 2018 2025             # local only
python scripts/import_f1db.py [--version vYYYY.RR.M]         # local only — download, verify sha256, import
python scripts/audit_results_vs_f1db.py [--modern-plan]      # local only — read-only results check vs F1DB
python scripts/backfill_results_from_f1db.py --from 1980 --to 2017 [--apply]  # local only — ADR 0009
```

### Schedule (Render worker)
There are no Render cron jobs: `src/server.py` runs `auto_runner.run_cycle` in a loop (20 min inside a
race-weekend window, 6 h outside it, which never touches the DB). Inside the window a `WorkerMemo`
skips the DB until the next action is due. Typical action timing:

**Conventional weekend:**
- **Saturday 22:00 UTC**: `ingest_qualifying` → `compute_features` → `compute_predictions`
- **Sunday 18:00 UTC**: `ingest_race` → `compute_season_stats`

**Sprint weekend:**
- **Friday 22:00 UTC**: `ingest_sprint_qualifying` → `compute_sprint_features` → `compute_sprint_predictions`
- **Saturday 16:00 UTC**: `ingest_sprint` → `compute_season_stats`
- **Saturday 22:00 UTC**: `ingest_qualifying` → `compute_features` → `compute_predictions`
- **Sunday 18:00 UTC**: `ingest_race` → `compute_season_stats`

### FastF1 usage
```python
import fastf1
session = fastf1.get_session(year, round_num, 'Q')  # or 'R', 'FP1', etc.
session.load(laps=True, telemetry=False, weather=True, messages=False)
```
Cache FastF1 responses locally during development: `fastf1.Cache.enable_cache('./cache')`.

### Error handling
Jobs exit with code 1 on failure (Render marks job failed for manual retrigger).
Never use `sleep()` inside jobs for waiting on data — retry on the next worker cycle instead. The
only sanctioned waits are `openf1_client`'s request pacing/backoff (see `docs/adr/0004`).
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
- Feature scores stored as `NUMERIC(6,5)` (0.00000 to 1.00000)
- Unique constraints on all natural keys (e.g. `UNIQUE(race_id, driver_id)`)

---

## Prediction Model

Two models: **GP model** (`weighted-v3`, 12 features) and **Sprint model** (`sprint-v2`, 8 features).
Full detail in `docs/prediction-model.md`.

### GP Weights (weighted-v3)
| Feature | Weight | Origin |
|---------|--------|--------|
| Car Performance | 20% | FastF1 race results → `team_season_stats.car_performance_score` |
| Long Run Pace | 15% | FastF1 FP2 (`fp2_long_run_times`) → fallback: `lap_times` |
| Tyre Degradation | 8% | FastF1 `lap_times.tyre_life` — regression slope at circuit |
| Reliability | 8% | FastF1 status → `team_season_stats.reliability_score` + driver DNF rate |
| Qualifying Delta | 8% | FastF1 Q1/Q2/Q3 times → weighted teammate gap, last 5 races |
| Driver Rating | 8% | FastF1 race points → `driver_season_stats.total_points / races / 25` |
| Win Rate | 8% | FastF1 race results → Bayesian: `(wins + 0.5) / (races + 2)` |
| Luck Factor | 7% | FastF1 finish position vs expected (car rank + grid), last 5 races |
| Circuit-Adj. Starting Position | 7% | FastF1 grid position × static circuit overtake rate + SC probability |
| Sector Strength | 6% | FastF1 qualifying sector times (S1/S2/S3 best vs field) |
| Circuit-Adj. Position Gain | 3% | FastF1 avg position gain × static circuit overtake rate |
| Weather Impact | 2% | FastF1 weather flag → historical wet-race finish avg; neutral if dry |

### Sprint Weights (sprint-v2)
| Feature | Weight | Origin |
|---------|--------|--------|
| Car Performance | 25% | FastF1 race results → `team_season_stats.car_performance_score` |
| Circuit-Adj. Starting Position | 25% | FastF1 SQ grid × static circuit overtake rate |
| Short Run Pace | 10% | FastF1 SQ1/SQ2/SQ3 times → fallback: main qualifying |
| Driver Rating | 10% | FastF1 sprint points / sprint races; fallback: main race rating |
| Weather Impact | 8% | FastF1 sprint weather → historical wet-race finish avg |
| Win Rate | 8% | FastF1 sprint wins; fallback: main race win rate |
| Luck Factor | 8% | FastF1 GP finish position vs expected, last 5 races |
| SQ vs Teammate | 6% | FastF1 SQ times → weighted teammate gap, last 5 sprint weekends |

### Static / Hardcoded inputs
- `circuits.overtake_rate` — seeded once per circuit, never changes
- `circuits.sc_probability` — **not static**: recomputed after every race ingest from `races.safety_car_laps`
  (`ingest_race._recompute_circuit_sc_probability`)
- Softmax temperature T=0.3 — `SOFTMAX_TEMPERATURE` in `data-engine/src/utils/feature_manifest.py`, imported by `prediction_runner.py`/`math_utils.py` (Python) and `apps/web/src/lib/f1/predictionMath.ts` (TS)
- Model weights — `GP_FEATURES`/`SPRINT_FEATURES` in `feature_manifest.py`, re-exported as `WEIGHTS` by `compute_features.py`/`compute_sprint_features.py`; checked against `docs/feature-weights.json` and `apps/web`'s `FEATURE_META`/`SPRINT_FEATURE_META`

### Softmax
Temperature T=0.3. Lower = more decisive. Do not increase T.
```python
exp_s = np.exp(scores / 0.3)
win_probabilities = exp_s / exp_s.sum()
```

---

## Development Setup

### Root (apps/api + apps/web)
```bash
bun run install:all  # bun install in both apps/api and apps/web
bun run dev           # runs apps/api (wrangler dev) + apps/web (astro dev) concurrently
bun run build          # apps/web production build
```
Plain orchestration scripts — no Bun workspaces. `data-engine/` isn't part of `bun run dev` since its
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

Applying the DB schema is covered under [Drizzle ORM](#drizzle-orm-appsapidrizzle) above — it's part of the `apps/api/` setup, not a separate package.

---

## Git / Commits

- **Never commit without being explicitly asked.** Do not auto-commit after fixes, refactors, or any other changes — always wait for the user to say "commit" or invoke `/commit`.
- **Always read `.claude/skills/commit/` before committing.** The skill contains the required format and rules; follow it exactly.
- Never deploy to Cloudflare from the CLI. Push to GitHub and let the Cloudflare integration deploy automatically.

---

## Code Style

- TypeScript strict mode everywhere in `apps/api/` and `apps/web/`
- No `any` types — define proper types in the app's `types/` folder (one file per domain, imported via its barrel)
- Python: type hints on all function signatures
- No comments explaining what code does — name things clearly instead
- Only comment WHY when it's non-obvious (a hidden constraint, a workaround)
- Comments must be at most 2 lines. Only go longer if it's genuinely unavoidable — that should be rare
- No console.log in production code — use structured logging patterns
