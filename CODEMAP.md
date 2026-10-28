# F1 Prediction: Code Map

Complete directory structure and file reference for the codebase.

## Project Structure

```
F1-prediction/
├── CLAUDE.md              # Agent guidelines, constraints, and project conventions
├── CODEMAP.md             # This file: codebase structure reference
├── CONTRIBUTING.md        # Contribution guidelines
├── CONTEXT.md             # Domain glossary: ubiquitous language for the project
├── README.md              # Project overview and getting started
├── LICENSE                # GPL-3.0
├── package.json           # Root orchestration: dev/build/install:all via plain `cd` scripts (no workspaces), husky
├── lint-staged.config.mjs # Pre-commit: typecheck + lint apps/api and apps/web on staged changes
├── .husky/pre-commit      # Runs lint-staged
├── docker-compose.test.yml# Local Postgres 16 + Neon HTTP proxy (:4445) for apps/api integration tests
├── .github/workflows/test.yml # CI: pytest, api (test:db:up + test/typecheck/lint), web, e2e Playwright
├── .github/workflows/f1db-import.yml # Weekly (Wed 06:00 UTC) + manual F1DB import; skips without a DATABASE_URL secret
├── preview/               # README screenshots
├── docs/                  # Project documentation (see Docs section below)
│   ├── adr/               # Numbered architectural decision records, 0000–0010
│   └── plans/             # intelligence-platform-roadmap.md: roadmap + free-tier budget rules
├── apps/                  # JS/Bun-only convention: orchestrated by root package.json, no workspaces
│   ├── api/               # Hono REST API: Cloudflare Workers; also owns Drizzle schema + migrations
│   ├── web/               # Astro SSR frontend: Cloudflare Pages
│   └── e2e/               # Playwright smoke tests for apps/web: own package.json + playwright.config.ts
├── data-engine/           # Python ETL batch jobs: Render (outside apps/: no dev server, one-shot jobs)
└── .claude/skills/        # Claude Code skill definitions (see Claude Skills section below)
```

---

## API (`apps/api/`)

Hono on Cloudflare Workers. NestJS-style module structure.
Must use `@neondatabase/serverless` (HTTP driver): no TCP in Workers.

```
apps/api/
├── src/
│   ├── main.ts                    # Entry point: logger, CORS, edgeCache() on /api/*, /api/health, mounts every module
│   ├── common/                    # Only what several modules share: module-only logic lives in that module's *.helpers.ts
│   │   ├── types/                 # Response types per domain (api, seasons, circuits, drivers, teams, races, race-events,
│   │   │                          #   strategy, race-story, telemetry, predictions, sprint, history, quality) + index.ts barrel
│   │   ├── constants.ts           # SPRINT_FORMATS: single source of truth shared by all services
│   │   ├── mappers.ts             # toDriver(), toTeam(), toRace(), toCircuit(), toRaceResult(), toQualifyingResult(), toSprintResult(): canonical row→DTO mappers used by all services
│   │   ├── standings.ts           # resolveSeason(), buildStandings(), buildCareerStats(), sortByChampionshipStanding(): shared standings/career-stats pipeline for drivers, teams, predictions; drivers/teams pass a StatsAdapter
│   │   ├── session-kind.ts        # GP / SPRINT descriptors: prediction, feature, lap and result tables, date column, upcoming/done
│   │   │                          #   statuses typed against the race status enum, grid sheet, mapFeatures(); isDone()
│   │   ├── session-reads.ts       # findPrediction(), findUpcomingPrediction(), findLapSummaries(): one read per kind, GP and sprint alike
│   │   ├── route.ts               # raceRoute / seasonRoute / driverRoute / teamRoute: id/year/session validation, the 404,
│   │   │                          #   Cache-Control from the loaded row's own status/season (never ?year=), {data,error} envelope
│   │   ├── feature-manifest.ts    # GP_FEATURE_MANIFEST (weighted-v4 JSONB name → camelCase key, label) + mapGpFeatures();
│   │   │                          #   SPRINT_FEATURE_MANIFEST (key, column, label, nullable) + mapFeatureRow(): weight-less, behind mapFeatures
│   │   ├── identity.ts            # personKey(), isSamePerson(), f1dbPersonKey(), constructorKey()/constructorTeamKeys(), f1dbConstructorId():
│   │   │                          #   the only "same driver / same team" rules; golden cases in docs/identity-cases.json (shared with Python)
│   │   ├── cache.ts               # CACHE_COMPLETED/ACTIVE/REFERENCE + cacheControlForStatus(), cacheControlForYear(), cacheIfData()
│   │   ├── edge-cache.ts          # edgeCache() middleware: serves repeat GETs from the Workers Cache API (custom domain only); skips errors/non-public responses
│   │   └── session.ts             # RACE_SESSION / QUALIFYING_SESSION: `?session=` param descriptors route.ts validates
│   ├── config/database.ts         # createDb(): Drizzle over Neon HTTP driver
│   ├── config/localNeonProxy.ts   # configureLocalNeonProxy(): points the Neon driver at docker-compose.test.yml's proxy (tests/migrate only, never the Worker)
│   ├── db/
│   │   ├── schema/                # Drizzle table definitions (source of truth)
│   │   │   ├── index.ts           # Re-exports all schemas
│   │   │   ├── seasons.ts
│   │   │   ├── circuits.ts        # Includes overtake_rate, sc_probability, category, corners/DRS, image URL
│   │   │   ├── teams.ts
│   │   │   ├── drivers.ts         # Season-scoped; unique per person per season (not per car number, ADR 0009)
│   │   │   ├── races.ts           # Includes sprint condition columns + event_format + OpenF1 session keys
│   │   │   ├── qualifying_results.ts
│   │   │   ├── race_results.ts
│   │   │   ├── race_control_messages.ts  # OpenF1 flags/SC/VSC/incident log per race + session_type (free/historical only, no live data)
│   │   │   ├── race_overtakes.ts  # OpenF1 on-track overtakes per race: two driver FKs (overtaking/overtaken)
│   │   │   ├── team_radio_clips.ts  # OpenF1 team radio audio URLs per race: one driver FK; coverage is inherently patchy (F1 doesn't release every clip)
│   │   │   ├── race_stints.ts     # Tyre stints, 2018+ (OpenF1 /stints from 2023, FastF1 before): one row per stint per session
│   │   │   ├── race_pit_stops.ts  # Pit stops, 2018+ (OpenF1 /pit from 2023, FastF1 before): stationary_ms only from the 2024 US GP on
│   │   │   ├── race_story.ts      # race_lap_traces (per-driver int[] arrays), race_battles, race_weather_traces: 2018+ (OpenF1 live, FastF1 backfill)
│   │   │   ├── qualifying_lap_telemetry.ts # Each driver's fastest Q/SQ lap (2018+: OpenF1 from 2023, FastF1 before) resampled every 10 m into one JSONB row
│   │   │   ├── title_odds.ts      # title_odds_drivers / title_odds_teams: Monte Carlo odds, one row per contender per round
│   │   │   ├── history.ts         # F1DB all-time tables: history_drivers, history_constructors, history_constructor_seasons,
│   │   │   │                      #   history_constructor_lineage, f1db_imports (CC-BY-4.0)
│   │   │   ├── lap_times.ts
│   │   │   ├── sprint_results.ts  # Sprint finish + SQ1/SQ2/SQ3 times + sq sector times
│   │   │   ├── sprint_lap_times.ts# Per-lap sprint data
│   │   │   ├── driver_season_stats.ts  # Includes sprint aggregates
│   │   │   ├── team_season_stats.ts
│   │   │   ├── race_predictions.ts
│   │   │   ├── driver_prediction_features.ts  # weighted-v4: features JSONB (value + contribution per feature)
│   │   │   ├── driver_sprint_features.ts  # 8-feature sprint scores
│   │   │   ├── fp2_long_run_times.ts      # FP2 per-driver long-run stint data (FP1 fallback on sprint weekends)
│   │   │   ├── sprint_predictions.ts      # Sprint predicted winner
│   │   │   ├── data_quality_runs.ts       # One row per data-quality audit run (summary JSON)
│   │   │   └── data_quality_issues.ts     # Per-run audit issues (table, check, severity, resolved)
│   │   ├── migrate.ts             # Applies drizzle/migrations SQL in order (db:migrate, test:db:up); tolerates already-applied objects
│   │   └── seed.ts                # Seeds static circuit data (track category, image paths) + seasons
│   └── modules/                   # Feature modules (service / controller / module)
│       ├── races/
│       │   ├── races.service.ts   # DB queries: race list, race detail (results, qualifying, lap summaries)
│       │   ├── races.controller.ts# Parses context, calls service, returns JSON
│       │   └── races.module.ts    # GET /, /:id
│       ├── circuits/              # Mounted at /api/races ahead of races' /:id (URLs predate the module)
│       │   ├── circuits.service.ts        # Circuit list, circuit details (history, eras, stats, outline), circuit telemetry (pole lap)
│       │   ├── circuit-era.helpers.ts     # Pure era bucketing: Era/EraMap/ERAS, aggregateEraWins(), buildDominanceByEra(), normalizeTeamKey()
│       │   ├── circuit-stats.helpers.ts   # Pure per-response stats: buildCircuitHistory(), computeQualifyingImpactStats/WeatherStats/SafetyCarStats(), pickFastestLap()
│       │   ├── circuit-headshots.helpers.ts # backfillDriverHeadshots(): the one DB-reading enrichment (latest driver profiles into per-era win entries; no writes)
│       │   ├── track-outline.helpers.ts   # buildOutlinePath(): pole-lap x/y telemetry → closed SVG path for the circuit outline
│       │   ├── track-profile.helpers.ts   # trackProfile(), thinTrace(): track character from one real qualifying lap
│       │   ├── circuits.controller.ts
│       │   └── circuits.module.ts         # GET /circuits, /circuit/:circuitKey, /circuit/:circuitKey/telemetry
│       ├── race-events/           # OpenF1-sourced race data, separate from races/ to keep its controller under budget
│       │   ├── openf1.mappers.ts         # toRaceControlMessage(), toRaceOvertake(), toTeamRadioClip()
│       │   ├── race-events.service.ts    # getRaceControlMessages(), getOvertakes(), getTeamRadio(): per session_type
│       │   ├── race-events.controller.ts # three raceRoute declarations (race control, overtakes, team radio)
│       │   └── race-events.module.ts     # GET /:id/race-control, /:id/overtakes, /:id/team-radio (mounted at /api/races)
│       ├── strategy/              # Mounted at /api/races
│       │   ├── strategy.service.ts    # findStrategy(): OpenF1 stints + pit stops per driver; derives stints from lap times when OpenF1 has none
│       │   ├── strategy.controller.ts
│       │   └── strategy.module.ts     # GET /:id/strategy
│       ├── race-story/            # Mounted at /api/races
│       │   ├── race-story.service.ts  # findRaceStory(): lap traces in finishing order, battles, minute-by-minute weather
│       │   ├── recap.service.ts       # findRecap(): home "last race" card: winner, model pick + hit, fastest stop, longest battle
│       │   ├── race-story.controller.ts
│       │   └── race-story.module.ts   # GET /:id/race-story, /:id/recap
│       ├── telemetry/             # Mounted at /api/races
│       │   ├── telemetry.service.ts   # findComparison(): who has a Q/SQ telemetry lap, then samples for the two chosen drivers only
│       │   ├── telemetry.controller.ts
│       │   └── telemetry.module.ts    # GET /:id/telemetry
│       ├── drivers/
│       │   ├── drivers.service.ts # Driver list, standings, detail, career stats
│       │   ├── racecraft.service.ts       # findRacecraft(): GP overtakes made/suffered/net per driver for a season (2023+)
│       │   ├── teammate-battle.service.ts # findBattle(): quali/race/points head-to-head + race-by-race list vs the team-mate
│       │   ├── qualifying-gap.helpers.ts  # qualifyingGapMs() (deepest shared Q session), median(): teammate quali gap
│       │   ├── classification.helpers.ts  # isClassifiedFinish(): DSQ/DNS count as non-finishes (ADR 0002, mirrors compute_season_stats.py)
│       │   ├── drivers.controller.ts
│       │   └── drivers.module.ts  # GET /standings, /racecraft, /, /:id/career, /:id/history (HistoryController), /:id/teammate-battle, /:id
│       ├── teams/
│       │   ├── teams.service.ts   # Team list, standings, detail, career stats, pit-crew rankings, one team's pit stops
│       │   ├── teams.controller.ts
│       │   └── teams.module.ts    # GET /standings, /pit-stops, /, /:id/career, /:id/pit-stops, /:id/history (HistoryController), /:id
│       ├── predictions/
│       │   ├── predictions.service.ts # Upcoming (date-guarded), by race, history (incl. sprint), accuracy-by-season, standings, model-info
│       │   ├── accuracy.helpers.ts    # aggregateAccuracyBySeason(): per-season gp/sprint/overall accuracy buckets
│       │   ├── prediction-history.helpers.ts # buildHistoryItems(), buildWinnerMap(), buildProbPosMaps(), mergeHistoryByDateDesc()
│       │   ├── intel-standings.helpers.ts # aggregateSeasonScores() (per-person average raw score + win probability) + buildIntelStandingRows() (rank + min-max normalise + sprint totals) for findIntelStandings()
│       │   ├── friday-pace.service.ts # findFridayPace(): each driver's best practice long run + gap to fastest
│       │   ├── title-odds.service.ts  # findTitleOdds(): latest round's driver/team title odds + per-round history for charting
│       │   ├── predictions.controller.ts
│       │   └── predictions.module.ts  # GET /model-info, /upcoming, /history, /accuracy, /standings, /title-odds, /race/:raceId/friday-pace, /race/:raceId
│       ├── sprint/
│       │   ├── sprint.service.ts  # Sprint prediction (upcoming/by race) + sprint detail: results, SQ grid, lap summaries
│       │   ├── sprint.controller.ts
│       │   └── sprint.module.ts   # GET /upcoming, /race/:raceId, /race/:raceId/detail
│       ├── history/               # F1DB all-time history (mounted at /api/history; driver/team history routes live on those modules)
│       │   ├── history.service.ts     # findRecords(), findMilestones(), findLineages(), findDriverHistory(), findTeamHistory(), findOnThisDay()
│       │   ├── history.helpers.ts     # Pure: buildCoreLinks() (F1DB → core page ids, active flag), nearestMonthDay() (wraps New Year), buildChases() (best active driver per record), groupLineages()
│       │   ├── history.controller.ts  # Also serves /api/drivers/:id/history + /api/teams/:id/history; validates date=MM-DD
│       │   └── history.module.ts      # GET /records, /milestones, /lineages, /on-this-day
│       ├── seasons/
│       │   └── seasons.ts         # One file: GET /, season list. Too small for a service/controller/module split
│       ├── search/
│       │   └── search.ts          # One file: GET /, global search query (unique drivers, teams, circuits)
│       └── quality/
│           └── quality.ts         # One file: GET /, latest data-quality report (dev-only, no write path);
│                                   #   exports castSeverity() for its own test
├── drizzle/
│   └── migrations/                # Generated SQL migration files + Drizzle metadata
│       ├── 0000_glamorous_galactus.sql … 0030_gp_features_jsonb.sql  # 31 migrations: initial schema, sprint,
│       │                                #   circuits, data quality, OpenF1, stints/pit stops, title odds, race story,
│       │                                #   weather traces, qualifying telemetry, F1DB history, per-person drivers,
│       │                                #   weighted-v4 (v3 score columns dropped, features JSONB)
│       └── meta/                        # Drizzle migration metadata (_journal.json, snapshots)
├── tests/
│   ├── unit/                      # bun test: mirrors src/, one *.test.ts per file
│   │   ├── modules/
│   │   │   ├── circuits/          # circuit-era + circuit-stats helpers, track-outline (viewBox, y flip), track-profile (throttle, braking, corners, thinTrace)
│   │   │   ├── drivers/           # classification (finishes vs DNF/DSQ/DNS), qualifying-gap (deepest shared session, median)
│   │   │   ├── history/           # history.helpers (buildCoreLinks, nearestMonthDay, buildChases, groupLineages)
│   │   │   ├── predictions/       # accuracy, prediction-history, intel-standings helpers
│   │   │   ├── race-events/       # openf1.mappers (race control, overtakes, team radio)
│   │   │   └── quality/quality.test.ts # castSeverity()
│   │   └── common/                # mappers, standings, feature-manifest, cache, identity (golden cases from docs/identity-cases.json)
│   ├── integration/                # bun test: real Hono `app.request()` against a LOCAL Postgres (docker-compose.test.yml behind
│   │   │                           #   a Neon HTTP proxy; `bun run test:db:up`, config in .env.test): never Neon
│   │   ├── races/races.test.ts     # list/filter/detail/circuit-history joins
│   │   ├── circuits/circuit-outline.test.ts # circuit outline from the latest stored pole lap; none without telemetry
│   │   ├── circuits/circuit-telemetry.test.ts # pole lap preferred over a faster non-pole lap; null without telemetry
│   │   ├── race-events/race-events.test.ts # race-control message + overtakes + team-radio lists, ordering, 404
│   │   ├── race-events/race-events-sessions.test.ts # ?session=sprint returns only sprint rows
│   │   ├── strategy/strategy.test.ts   # stints + stops in finishing order, lap-time-derived fallback, sprint session
│   │   ├── race-story/race-story.test.ts # traces in finishing order, named battles, weather °C, short cache when not backfilled
│   │   ├── telemetry/telemetry.test.ts # lists everyone with telemetry, samples only for the two requested / two fastest
│   │   ├── hub/hub.test.ts         # race recap (winner, model pick, fastest stop, longest battle) + on-this-day races
│   │   ├── history/history.test.ts # leaders w/ flags + active, strike-rate min starts, chases, milestones, lineages, on-this-day fallback
│   │   ├── edge-cache/edge-cache.test.ts # edge hits skip the DB; never caches errors/non-public; per-request CORS origin
│   │   ├── drivers/drivers.test.ts # list/filter/standings/detail
│   │   ├── drivers/career.test.ts  # career + search link a person's seasons across name variants
│   │   ├── drivers/racecraft.test.ts   # net GP overtakes ranking, sprint passes excluded
│   │   ├── drivers/teammate-battle.test.ts # head-to-head scores + race-by-race list with quali gap
│   │   ├── teams/teams.test.ts     # list/standings/detail
│   │   ├── teams/pit-stops.test.ts # crews ranked by median stationary time, stops without one ignored
│   │   ├── teams/team-pit-stops.test.ts # one team's timed GP stops, in round and lap order
│   │   ├── seasons/seasons.test.ts # race-count aggregation
│   │   ├── search/search.test.ts   # cross-season dedup
│   │   ├── predictions/predictions.test.ts # upcoming/by-id/history/standings/accuracy/model-info
│   │   ├── predictions/friday-pace.test.ts # best long run per driver + gap to fastest
│   │   ├── predictions/title-odds.test.ts  # latest-round odds ranked + history, expected-points tiebreak
│   │   ├── sprint/sprint.test.ts   # upcoming/by-id/detail, conventional-race guard
│   │   ├── session-kind/           # predictions + lap summaries asserted the same way for GP and sprint (pit/null laps excluded)
│   │   ├── route/route.test.ts     # 400 on bad id/year/session, 404, Cache-Control from the row's own season not ?year=
│   │   └── teams/career.test.ts    # a team's career follows its constructor across rebrands
│   └── support/
│       ├── app/request.ts          # apiRequest(): in-process app.request() with TEST_DATABASE_URL env
│       ├── db/test-db.ts           # getTestDb()/truncateAll(): refuses *.neon.tech hosts and TEST_DATABASE_URL === DATABASE_URL
│       └── factories/              # one insert helper per table, FK chain: season → team/circuit → driver → race → results
│                                   #   (+ prediction/sprint features, sprint lap times, OpenF1 events, stints/pit stops, race story, telemetry, title odds, history)
├── eslint.config.js               # Flat config: tiered `max-lines` (controller 80 / module 50 / service+helpers 200 / common 150 / default 150; schema+seed+types.ts+tests off), run via `bun run lint`
├── wrangler.toml                  # CF Workers config: keep_vars = true
├── drizzle.config.ts              # schema: src/db/schema, out: drizzle/migrations
├── tsconfig.json                  # CF Workers target: excludes Node-only files (drizzle.config, seed)
├── tsconfig.node.json             # Node target for drizzle.config.ts + seed.ts (@types/node)
├── .env.example                   # DATABASE_URL (+ R2 vars)
├── .env.test                      # Committed: TEST_DATABASE_URL + NEON_FETCH_ENDPOINT for the local docker proxy
└── package.json                   # test / test:unit / test:integration / test:db:up|down / db:* scripts
```

### Module Pattern

Each module follows the same three-file pattern:

| File | Responsibility |
|------|---------------|
| `*.service.ts` | Drizzle queries, no Hono context, returns typed data |
| `*.controller.ts` | Reads `c.req.query`/`c.req.param`, calls service, returns `c.json()` |
| `*.module.ts` | Creates Hono sub-router, wires routes to controller handlers |

A module with a second query area adds another `*.service.ts` beside the first (e.g. `drivers/racecraft.service.ts`,
`predictions/title-odds.service.ts`) under the same controller. `seasons`, `search`, `quality` are single files.

### Routes

| Method | Path | Query params |
|--------|------|-------------|
| GET | `/api/health` | - |
| GET | `/api/seasons` | - |
| GET | `/api/search` | - |
| GET | `/api/quality` | `year` (dev-only report) |
| GET | `/api/races` | `year`, `status` |
| GET | `/api/races/circuits` | - |
| GET | `/api/races/circuit/:circuitKey` | - |
| GET | `/api/races/circuit/:circuitKey/telemetry` | - |
| GET | `/api/races/:id` | - |
| GET | `/api/races/:id/race-control` | `session` (`race`\|`sprint`) |
| GET | `/api/races/:id/overtakes` | `session` |
| GET | `/api/races/:id/team-radio` | `session` |
| GET | `/api/races/:id/strategy` | `session` |
| GET | `/api/races/:id/race-story` | `session` |
| GET | `/api/races/:id/recap` | - |
| GET | `/api/races/:id/telemetry` | `session` (`Q`\|`SQ`, default `Q`), `a`, `b` (driver codes) |
| GET | `/api/drivers` | `year`, `team_id` |
| GET | `/api/drivers/standings` | `year` |
| GET | `/api/drivers/racecraft` | `year` |
| GET | `/api/drivers/:id` | `year` |
| GET | `/api/drivers/:id/career` | - |
| GET | `/api/drivers/:id/history` | - |
| GET | `/api/drivers/:id/teammate-battle` | `year` (cache lifetime only) |
| GET | `/api/teams` | `year` |
| GET | `/api/teams/standings` | `year` |
| GET | `/api/teams/pit-stops` | `year` |
| GET | `/api/teams/:id` | `year` |
| GET | `/api/teams/:id/career` | - |
| GET | `/api/teams/:id/pit-stops` | `year` (cache lifetime only) |
| GET | `/api/teams/:id/history` | - |
| GET | `/api/predictions/model-info` | - |
| GET | `/api/predictions/upcoming` | - |
| GET | `/api/predictions/history` | `year` |
| GET | `/api/predictions/accuracy` | - |
| GET | `/api/predictions/standings` | `year` |
| GET | `/api/predictions/title-odds` | `year` |
| GET | `/api/predictions/race/:raceId` | - |
| GET | `/api/predictions/race/:raceId/friday-pace` | - |
| GET | `/api/sprint/upcoming` | - |
| GET | `/api/sprint/race/:raceId` | - |
| GET | `/api/sprint/race/:raceId/detail` | - |
| GET | `/api/history/records` | - |
| GET | `/api/history/milestones` | - |
| GET | `/api/history/lineages` | - |
| GET | `/api/history/on-this-day` | `date` (`MM-DD`, required) |

---

## Frontend (`apps/web/`)

Astro SSR with Cloudflare adapter. All data fetching is server-side in Astro frontmatter: the only client-side
fetches are `GlobalSearch`, `DriverCompareTool`, `TeamCompareTool` (see CLAUDE.md §3).

```
apps/web/
├── src/
│   ├── content/
│   │   └── config.ts              # Astro Content Layer: docs collection via glob('../../docs'), excluding adr/ + plans/
│   ├── pages/                     # File-based routes
│   │   ├── index.astro            # Home: season progress strip + next race, last race (Recap), championship blocks
│   │   ├── prediction.astro       # Tabs: Upcoming (GP + sprint panels, model ratings) · Scorecard (history, calibration, Brier)
│   │   ├── prediction/[id].astro  # Historical GP prediction: contribution breakdown, radar compare, Friday pace, what-if lab
│   │   ├── health-quality.astro   # Dev-only data-quality dashboard (404-guarded outside DEV)
│   │   ├── history.astro          # /history: tabs Records · Milestones · On this day · Lineage (F1DB)
│   │   ├── compare/
│   │   │   ├── drivers.astro      # /compare/drivers: driver head-to-head comparison tool
│   │   │   └── teams.astro        # /compare/teams: team head-to-head comparison tool
│   │   ├── docs/
│   │   │   ├── index.astro        # Docs index: card grid of all docs
│   │   │   └── [slug].astro       # Individual doc page: all-docs sidebar, content, on-this-page rail
│   │   ├── circuits/
│   │   │   ├── index.astro        # Circuits directory: tabs All circuits · This season (filters/sorting)
│   │   │   └── [key].astro        # Circuit detail: tabs Overview · Winners · Dominance · Telemetry; weather forecast
│   │   ├── races/
│   │   │   ├── index.astro        # Race calendar: sprint-aware cards
│   │   │   └── [id]/
│   │   │       ├── index.astro    # GP detail: results, qualifying, laps, strategy, incidents, overtakes, team radio, circuit;
│   │   │       │                  #   links to race story + telemetry once completed
│   │   │       ├── sprint.astro   # Sprint detail: same tab set over the sprint session (SQ grid, sprint laps, conditions)
│   │   │       ├── race-story.astro # Gap-to-leader + position charts, battles, session weather (`?session=sprint` for the sprint)
│   │   │       └── telemetry.astro  # Two drivers' fastest Q/SQ laps: speed/delta traces, mini-sector dominance map (plain GET form)
│   │   ├── prediction/
│   │   │   └── sprint/
│   │   │       └── [id].astro     # Sprint prediction detail: same feature set as GP, sprint model (8 weights)
│   │   ├── drivers/
│   │   │   ├── index.astro        # Tabs: Standings · Title fight · Racecraft
│   │   │   └── [id].astro         # Driver profile: tabs This season · Teammate battle · Career (F1DB card + seasons) · Model
│   │   └── teams/
│   │       ├── index.astro        # Tabs: Standings · Title odds · Pit crews
│   │       └── [id].astro         # Team profile: tabs This season · Pit crew · History
│   ├── layouts/
│   │   └── BaseLayout.astro       # Shared layout: Sidebar + MobileNav, slot, Footer, GlobalSearch; reads the sidebar cookie
│   ├── components/                # Generic, cross-feature only: domain UI lives in features/
│   │   ├── layout/
│   │   │   ├── Sidebar.astro      # Desktop collapsible sidebar: search, Season/Explore groups, docs, collapse toggle
│   │   │   ├── MobileNav.astro    # Mobile top bar + drawer with the same grouped list + focus-trap script
│   │   │   ├── NavGroups.astro    # The grouped destination list both Sidebar and MobileNav render
│   │   │   ├── SiteLogo.astro     # Brand mark SVG
│   │   │   ├── navLinks.ts        # buildNavGroups() + buildNavUtilities(isDev) + activeDestination(): nav model
│   │   │   └── Footer.astro       # Shared footer
│   │   ├── page/                  # Page chrome
│   │   │   ├── PageHeader.astro       # Kicker + h1 + subtitle; "aside" slot holds the season picker
│   │   │   ├── PageTabs.astro         # Server-rendered link tabs (?tab=, or a route href per tab)
│   │   │   ├── TabIntro.astro         # Tab lead line + term legend (replaces footnote paragraphs under tables)
│   │   │   ├── SectionKicker.astro    # "./label" section heading with optional link
│   │   │   ├── EmptyState.astro       # Bordered "nothing here yet" / error message
│   │   │   ├── YearSelect.astro       # Year selector; hrefFor (seasonTabHref) or extraParams keeps tab/filter on year change
│   │   │   └── YearSelectLinks.astro  # Year selector using anchor links; used by driver/team profile pages
│   │   ├── data/                  # Data display
│   │   │   ├── DataList.astro / DataRow.astro  # Standings-style row list with table roles (rows/cells) for a11y + tests
│   │   │   ├── RankCell.astro         # Rank cell: trophy for P1, highlighted top N
│   │   │   ├── StatTiles.astro        # Grid of label/value stat tiles
│   │   │   ├── HeadToHead.astro       # Two-side head-to-head bar rows (driver teammate tab, team page)
│   │   │   ├── headToHead.ts          # HeadToHeadRow type, importable by .ts loaders
│   │   │   ├── LineChart.astro        # Plain SVG multi-series line chart: nice ticks, spread end labels
│   │   │   ├── chartScale.ts          # linearScale(), niceTicks(): d3-style scales for the plain-SVG charts
│   │   │   └── labelLayout.ts         # spreadLabels(): nudge end-of-line chart labels apart without reordering
│   │   ├── identity/
│   │   │   └── DriverIdentity.astro / TeamIdentity.astro  # Headshot/logo + linked name cell inside a DataRow
│   │   └── ui/                    # Shadcn/ui primitives + generic widgets
│   │       ├── table.tsx
│   │       └── search-select.tsx  # Generic autocomplete combobox; shared by Driver/TeamCompareTool
│   ├── features/
│   │   ├── predictions/              # Shared prediction UI: GP + sprint pages compose these (accent prop)
│   │   │   ├── types.ts               # PredictionAccent, GP_ACCENT/SPRINT_ACCENT, PredictionPageKind, view-model interfaces
│   │   │   ├── buildPredictionPageData.ts  # buildPredictionPageData(kind, raceId): the fetch/winner-pick/
│   │   │   │                          #   view-model assembly both prediction/[id].astro and prediction/sprint/[id].astro
│   │   │   │                          #   call; returns facts + a slim PREDICTION_BEHAVIOUR axis (fetchers, weights, meta, date field)
│   │   │   ├── predictionCopy.ts       # PREDICTION_COPY[kind]: all GP-vs-sprint wording (titles, kicker, labels, headings, blurbs); the views own it
│   │   │   └── components/
│   │   │       ├── PredictionPageBody.astro        # Full page body (header→banner→table→radar→Friday pace→WhatIfLab); both
│   │   │       │                                   #   [id].astro routes reduce to a fetch + <PredictionPageBody data={data} copy={copy} />
│   │   │       ├── ConfidenceBadge.astro           # LOCK / LIKELY / TOSS-UP badge from the P1−P2 win-probability gap
│   │   │       ├── PredictionHeader.astro          # Round kicker + title + ConfidenceBadge + circuit/model lines
│   │   │       ├── PredictionOutcomeBanner.astro   # Predicted → actual winner banner
│   │   │       ├── ContributionBar.astro           # "why {CODE}": stacked bar of each feature's share of the driver's edge over the field
│   │   │       ├── PredictionDriverTable.astro     # Full ranked driver table (accent via scoped <style define:vars>)
│   │   │       ├── DriverRadarCompare.astro        # 2-driver radar of features ranked within the field; bundled <script> reads a JSON payload node
│   │   │       ├── FridayPaceTable.astro           # GP only: each driver's best practice long run, compound, gap to fastest
│   │   │       ├── ModelWeightsGrid.astro          # Feature-weight grid (rendered xl + mobile per page)
│   │   │       ├── ModelRatingsTable.astro         # /prediction: season-average model rating per driver
│   │   │       ├── WhatIfLab.astro                 # Re-weight sliders scale each feature's term; whatIfProbabilities() in-browser
│   │   │       ├── Scorecard.astro                 # Scorecard tab: hit rates, Brier, best call/worst miss/streak, race by race, seasons
│   │   │       ├── CalibrationChart.astro          # Predicted vs actual win-rate scatter + perfect-calibration diagonal
│   │   │       └── UpcomingPredictionPanel.astro   # /prediction hero panel (GP + sprint share it)
│   │   ├── races/
│   │   │   ├── loadRacePageData.ts    # loadRacePageData(kind, id): one loader for the GP and sprint race pages
│   │   │   ├── raceSessionBehaviour.ts # GP vs sprint descriptor: fetchers, status rules, visible tabs, labels, accent
│   │   │   ├── raceTabs.ts            # initRaceCountdown() + initRaceTabs(): shared by GP + sprint detail scripts
│   │   │   ├── raceEventDisplay.ts    # timeOf(), dotColor(): shared by the three Race Event list components
│   │   │   ├── calendar.ts            # calendarEntries() (sprint weekends → two entries, filter, sort), calendarQuery(), calendarSummary()
│   │   │   ├── loadRaceEvents.ts      # loadRaceEvents(id, session): strategy + incidents + overtakes + radio, each degrading alone; raceEventTabs()
│   │   │   ├── raceView.ts            # GP/sprint page view logic: predicted podium, winner, fastest lap, conditions, year links, SQ grid
│   │   │   ├── gridPenalties.ts       # gridDrops(): grid drops vs qualifying (pit-lane start = grid 0)
│   │   │   ├── weatherSpells.ts       # rainSpells(): contiguous rainfall minutes → spells
│   │   │   └── components/
│   │   │       ├── LapChart.astro         # Plain SVG lap time chart (no chart library)
│   │   │       ├── CalendarRow.astro / CalendarCard.astro # /races: completed row, upcoming card (status badge + prediction links)
│   │   │       ├── RaceEventPanels.astro  # Strategy / Incidents / Overtakes / Team radio tab panels, shared by GP + sprint pages
│   │   │       ├── CircuitStatsGrid.astro # Circuit tab: laps, length, distance, corners, DRS, overtake rate (race or sprint distance)
│   │   │       ├── RaceTabs.astro / RaceTabPanel.astro # Client-side tab strip + panels (namespaced ids) + route links for heavy analysis
│   │   │       ├── SessionSwitcher.astro  # Grand Prix ⇄ Sprint switch for a sprint weekend (overridable hrefs)
│   │   │       ├── StintChart.astro       # Strategy tab: SVG tyre-stint bars per driver, compound colours
│   │   │       ├── PitStopTable.tsx       # Strategy tab: per-driver pit stops (RaceResultsTable conventions)
│   │   │       ├── BattleList.astro       # Race story: longest close battles (chaser, leader, laps, min gap)
│   │   │       ├── WeatherStrip.astro     # Race story: track/air temperature LineChart + rain spells
│   │   │       ├── RaceControlTimeline.astro # Flags/SC/VSC/incident log, ordered by session time
│   │   │       ├── OvertakesList.astro    # On-track overtakes list; resolves driver codes via a driverMap prop built from race results
│   │   │       ├── TeamRadioList.astro    # Team radio clip list with a custom play/pause + progress-bar player (native <audio controls> didn't fit the dark UI)
│   │   │       ├── RaceResultsTable.tsx   # Race results with team color dots; flColor prop for sprint (orange)
│   │   │       ├── QualifyingGrid.tsx     # Qualifying session grid; labelPrefix prop ("Q" or "SQ")
│   │   │       ├── RaceYearSelect.astro   # Year selector for race/sprint detail; variant="orange"|"purple", extraParams prop
│   │   │       ├── RaceHeroInfo.astro     # Hero left column: status badge, meta, conditions strip, countdown (accent prop)
│   │   │       └── RacePredictionPanel.astro  # Hero right column: predicted winner + podium (accent prop)
│   │   ├── telemetry/
│   │   │   ├── telemetryCompare.ts    # lapDelta(), sectorBounds(), miniSectorWinners(): two resampled laps compared
│   │   │   ├── trackMap.ts            # projectTrack(): telemetry x/y → SVG points, aspect ratio preserved
│   │   │   └── components/
│   │   │       └── DominanceMap.astro # Track map coloured by which of two drivers won each mini-sector
│   │   ├── drivers/
│   │   │   ├── loadDriverPageData.ts  # loadDriverPageData(url, id): career year, open tab's fetch only, degraded optional data
│   │   │   └── teammateTally.ts       # Per-driver podiums, retirements, averages, best finish over shared races
│   │   ├── drivers/components/
│   │   │   ├── TeammateBattleCard.astro # Teammate tab: quali gap tiles, head-to-head bars, race-by-race list
│   │   │   ├── DriverStatsGrid.tsx    # Driver season stats card grid
│   │   │   ├── RecentResultsTable.tsx # Compact recent results table
│   │   │   ├── DriverCareerTable.astro # Per-season career rows (Career tab)
│   │   │   └── ModelTrackRecord.astro # Races the model tipped this driver to win (Model tab)
│   │   ├── teams/
│   │   │   ├── loadTeamPageData.ts    # loadTeamPageData(url, id): career year, open tab's fetch, teammate head-to-head rows
│   │   │   ├── pitStopSummary.ts      # driverStopSummaries(): per-driver stop count, median, best
│   │   │   ├── teamHistory.ts         # mergeTeamHistory(): our seasons + F1DB chassis/power unit by year
│   │   │   └── components/
│   │   │       ├── TeamPitCrew.astro  # Pit crew tab: tiles, every-stop dot chart, per-driver split, all crews
│   │   │       ├── PitCrewRankingTable.astro # Crews ranked by median stationary time (/teams Pit crews tab + team Pit crew tab)
│   │   │       └── TeamHistoryTable.astro # History tab: one season-by-season table incl. chassis + power unit
│   │   ├── standings/components/
│   │   │   ├── ShareBar.astro         # Percentage bar cell (title odds)
│   │   │   ├── DriverStandingsTable.astro / TeamStandingsTable.astro  # Standings tabs on /drivers, /teams
│   │   │   ├── TitleFight.astro       # /drivers Title fight: odds table, mathematically-out flags, odds-over-season chart
│   │   │   ├── RacecraftTable.astro   # /drivers Racecraft: overtakes made/suffered/net
│   │   │   └── ConstructorTitleOdds.astro # /teams Title odds: constructors' title probability + likely final points
│   │   ├── hub/                       # Home
│   │   │   ├── raceHighlights.ts      # Podium, pole, fastest lap, retirements from a race's results
│   │   │   ├── nextSession.ts         # nextSession(), weekendSessions(): done/next/upcoming session state for a race weekend
│   │   │   ├── modelVerdict.ts        # The model's GP call for a race: pick, confidence, winner's rank, season tally
│   │   │   ├── types.ts               # HomeFact
│   │   │   └── components/            # Home's three blocks + header strip
│   │   │       ├── HomeBlock.astro    # Shared block frame: ./kicker heading (region name) + footer links
│   │   │       ├── HomeFacts.astro    # Compact label/value fact grid inside a block
│   │   │       ├── SeasonProgress.astro # Header strip: one segment per round, next round highlighted
│   │   │       ├── NextRaceBlock.astro # Countdown, weekend schedule (local times), circuit facts, model top 3
│   │   │       ├── LastRaceBlock.astro # Podium, race facts, model check, Recap lines
│   │   │       └── ChampionshipBlock.astro # Top 5 drivers + teams: points, gap, title odds
│   │   ├── history/                   # F1DB all-time history: /history + driver/team career tabs
│   │   │   ├── loadHistoryPageData.ts # loadHistoryPageData(url): open tab's fetch + leaderboard/record rows
│   │   │   ├── types.ts               # Leaderboard / record tile view-model types
│   │   │   ├── historyView.ts         # Pure view helpers: bar widths, record holders, rate/chase summary, month-day
│   │   │   │                          #   parse/step/format, years-ago label, lineage timeline spans + totals + colours
│   │   │   ├── f1dbCountries.ts       # F1DB country id ('united-kingdom') → flag emoji / display name
│   │   │   └── components/
│   │   │       ├── RecordTile.astro       # Headline record tile: value, holder(s) with flag + active dot
│   │   │       ├── Leaderboard.astro      # Ranked list w/ bars, flags, active dot; top 5 shown + <details> expander
│   │   │       ├── RecordChases.astro     # How far the best active driver is from each record (progress bar)
│   │   │       ├── LineageTimeline.astro  # Lineage tab: team family timeline (member segments by year) + chain list
│   │   │       ├── OnThisDayList.astro    # On this day tab: prev/next date nav, nearest-date fallback, races with winners
│   │   │       ├── CareerCard.astro       # Driver Career tab: F1DB all-time totals + debut/first podium/pole/win
│   │   │       ├── ActiveBadge.astro      # "active" dot (compact) or badge for drivers on the current grid
│   │   │       └── F1dbCredit.astro       # CC-BY-4.0 F1DB attribution line
│   │   ├── circuits/
│   │   │   ├── components/
│   │   │   │   ├── CircuitsGrid.tsx      # React component for circuits grid (filters/sorting)
│   │   │   │   ├── CircuitOverview.astro # Overview tab: track card, key stats, model insights, forecast, safety car, weather split
│   │   │   │   ├── CircuitTrackCard.astro # Track photo with pole-lap outline fallback (+ broken-image script)
│   │   │   │   ├── WeatherForecast.tsx   # React weather forecast widget (Open-Meteo API)
│   │   │   │   ├── CircuitTelemetryProfile.astro # Telemetry tab: pole-lap tiles, speed trace, corners by apex speed
│   │   │   │   ├── CircuitWinningFacts.astro # Winners tab sidebar: fastest lap record + how races here are won
│   │   │   │   ├── CircuitWinnersTable.astro   # Recent-winners list for the circuit
│   │   │   │   └── DominanceCard.astro         # Era-filtered constructor/driver dominance + tab script
│   │   │   ├── circuitCoordinates.ts  # Track lat/lng for the race-week weather forecast
│   │   │   ├── circuitView.ts         # isRaceWeekCircuit() (forecast only for the next race's track), weatherSplit()
│   │   │   ├── winnerFacts.ts         # winnerFacts(): races, different winners, longest streak at a circuit
│   │   │   └── weather.ts             # Open-Meteo forecast fetch + ForecastDay type
│   │   ├── compare/
│   │   │   ├── components/
│   │   │   │   ├── DriverCompareTool.tsx  # Driver head-to-head comparison: entity-specific config over shared compare pieces
│   │   │   │   ├── TeamCompareTool.tsx    # Team head-to-head comparison: entity-specific config over shared compare pieces
│   │   │   │   ├── CompareLayout.tsx      # Two-column shell: stats left, sticky controls + A/B cards panel right; stacks on mobile
│   │   │   │   ├── ComparisonRow.tsx      # Generic stat comparison bar; shared by Driver/TeamCompareTool
│   │   │   │   ├── CompareEntityCard.tsx  # Generic profile card (slot badge + avatar/logo + name + subtitle); shared by both tools
│   │   │   │   ├── CompareSlotBadge.tsx   # A/B side badge in the entity's colour
│   │   │   │   ├── CompareModeToggle.tsx  # Season/career mode switch
│   │   │   │   ├── CompareYearSelect.tsx  # Year selector variant for compare tools
│   │   │   │   └── CompareStatus.tsx      # Loading/error/empty-stats status display
│   │   │   ├── compareStats.ts        # aggregateCareerStats() + DEFAULT_COMPARE_YEAR: career stat aggregation
│   │   │   ├── driverCompareConfig.ts # seasonStatConfig + careerStatConfig: the driver stat rows
│   │   │   ├── teamCompareConfig.ts   # the team stat rows (championship points from the API's championshipPoints)
│   │   │   ├── compareReducer.ts      # Pure compareReducer(state, action, config): hydrate/year/selection/mode
│   │   │   │                          #   transitions + stale-request guarding; no React import, tested directly
│   │   │   ├── useCompareController.ts # Thin useReducer wiring over compareReducer.ts: URL sync via injectable
│   │   │   │                          #   locationAdapter, discriminated season/career `comparison` result
│   │   │   └── compareTabs.ts         # COMPARE_TABS: Drivers/Teams route tabs shared by both compare pages
│   │   ├── docs/components/
│   │   │   └── OnThisPage.astro       # Sticky right-rail TOC of a doc's h2 sections; scrollspy via IntersectionObserver
│   │   └── search/
│   │       ├── components/
│   │       │   └── GlobalSearch.tsx   # React global search palette (cmdk): render only
│   │       └── useGlobalSearch.ts     # Search-open state hook (keyboard shortcut, sidebar/top-bar search button bridge, fetch-on-open, close animation)
│   ├── lib/                       # App plumbing + shared F1 reference data (single-feature logic lives in its feature)
│   │   ├── api.ts                 # Typed API client: all fetch calls, uses PUBLIC_API_URL
│   │   ├── site.ts                # SITE_NAME: the brand string
│   │   ├── pageTabs.ts            # resolveTab() + tabHref() + seasonTabHref(): ?tab= link tabs that keep other params
│   │   ├── careerYear.ts          # resolveCareerYear(): requested year → current year → latest active season
│   │   ├── sidebarState.ts        # Sidebar collapse cookie: isSidebarCollapsed() + sidebarCookie()
│   │   ├── legacyRedirects.ts     # legacyRedirect(path, search): retired URLs (prediction recap, /records, /drivers|teams/compare) → their new home
│   │   ├── utils.ts               # cn() (clsx + tailwind-merge), unwrapSettled(), formatMs/Probability/Date/StopSeconds/AgeFromDays
│   │   └── f1/                    # F1 reference data + maths used across features
│   │       ├── teamColors.ts      # team_key → official hex color map (fallback #6B7280)
│   │       ├── teamLogos.ts       # team_key → /teams/<file> static logo path (null if no logo)
│   │       ├── countryFlags.ts    # country/nationality/driver code → emoji flag + display name helpers
│   │       ├── predictionMath.ts  # softmax (SPRINT_SOFTMAX_TEMPERATURE=0.3 for sprint-v2), radarFeatures(),
│   │       │                      #   confidenceTier, brierScore, calibrationBuckets, driverPredictionRecord,
│   │       │                      #   bestCall/worstMiss/longestStreak, GP_WEIGHTS/SPRINT_WEIGHTS + *_FEATURE_META
│   │       │                      #   (GP: v4 importance %; the canonical TS-side manifest, checked against docs/feature-weights.json)
│   │       ├── predictionTerms.ts # gpTerms()/sprintTerms(): each driver's log-odds terms; edgeBreakdown(), fieldScaled(),
│   │       │                      #   whatIfProbabilities(): the "why" bar, radar and What-If Lab for both models
│   │       ├── championshipMath.ts # titleContention() (mathematically out), remainingSessions(), formatTitleOdds()
│   │       └── tyres.ts           # compoundToken(compound, year): tyre compound → colour token (2018 named compounds use the 2018 palette)
│   ├── middleware.ts              # 301s retired URLs via legacyRedirect()
│   ├── types/                     # Type-only re-exports of apps/api common/types/ (+ search.ts GlobalSearchResponse): seasons, circuits,
│   │                              #   drivers, teams, races, race-events, strategy, race-story, telemetry, predictions,
│   │                              #   sprint, history, quality: imported via the index.ts barrel as '@/types'
│   ├── styles/
│   │   └── globals.css            # Tailwind base + CSS custom properties
│   └── env.d.ts                   # Astro env type declarations
├── public/
│   ├── favicon.svg
│   ├── robots.txt
│   ├── og-image.jpg               # 1200×630 link-preview image (og:image / twitter:image)
│   └── teams/                     # Static team logo files (PNG/SVG/JPG) served at /teams/<teamKey>.*
├── tests/
│   ├── unit/
│   │   ├── features/compare/
│   │   │   ├── compareStats.test.ts          # aggregateCareerStats(): pure, `node` env
│   │   │   ├── driverCompareConfig.test.ts / teamCompareConfig.test.ts  # championship points row reads championshipPoints
│   │   │   ├── compareReducer.test.ts        # pure, `node` env: hydrate/year/mode transitions, stale-request
│   │   │   │                                 #   guarding, explicit 6bf3415 hydration-race regression case
│   │   │   └── useCompareController.test.ts  # jsdom: URL hydration, career mode, location-adapter seam
│   │   ├── components/
│   │   │   ├── layout/navLinks.test.ts       # pure: sidebar groups, utilities, active-destination matching
│   │   │   └── data/                         # chartScale, labelLayout
│   │   ├── lib/                              # pure, `node` env: pageTabs / sidebarState / legacyRedirects / utils
│   │   │   └── f1/                           # predictionMath (all exports), predictionTerms, championshipMath, teamColors, teamLogos, tyres
│   │   ├── features/races/ · features/telemetry/  # calendar, raceView + raceEventTabs, gridPenalties, weatherSpells, raceEventDisplay · telemetryCompare, trackMap
│   │   ├── features/predictions/
│   │   │   └── buildPredictionPageData.test.ts / predictionCopy.test.ts  # GP + sprint page data, copy table
│   │   ├── features/{drivers,teams,races,history}/load*PageData.test.ts  # page-data loaders, `node` env, MSW-stubbed API
│   │   ├── features/history/
│   │   │   └── historyView.test.ts / f1dbCountries.test.ts  # pure, `node` env: bars, holders, rates, chases, month-day, lineage, flags
│   │   ├── features/hub/
│   │   │   └── raceHighlights.test.ts / modelVerdict.test.ts / nextSession.test.ts  # pure, `node` env
│   │   ├── features/drivers/
│   │   │   └── teammateTally.test.ts         # pure, `node` env
│   │   ├── features/circuits/
│   │   │   └── winnerFacts.test.ts           # pure, `node` env
│   │   ├── features/teams/
│   │   │   └── teamTabs.test.ts              # pure, `node` env: driverStopSummaries, mergeTeamHistory
│   │   ├── features/races/
│   │   │   └── raceEventDisplay.test.ts      # pure, `node` env: timeOf(), dotColor()
│   │   └── features/search/                  # jsdom: hook + component tests, MSW-mocked API
│   │       ├── useGlobalSearch.test.ts
│   │       └── GlobalSearch.test.tsx
│   └── support/
│       ├── setup.ts                # jest-dom matchers, MSW server lifecycle, ResizeObserver stub for cmdk
│       └── msw/                    # fixtures.ts + handlers.ts + server.ts: mocks src/lib/api.ts endpoints;
│                                   #   routes.ts: apiOk/apiError/recordApiRequests for loader tests
├── vitest.config.ts                # jsdom is opt-in per file via `// @vitest-environment jsdom`; default env is `node`
├── eslint.config.js              # Flat config: tiered `max-lines` (pages 300 / components 250 / lib 200), run via `bun run lint`
├── wrangler.toml                  # CF Pages config: keep_vars = true, PUBLIC_API_URL
├── astro.config.mjs               # output: 'server', Cloudflare adapter
├── tailwind.config.mjs
├── postcss.config.cjs
├── .env.example                   # PUBLIC_API_URL
├── tsconfig.json
└── package.json
```

### Pages

| Route | Data source | Notes |
|-------|-------------|-------|
| `/docs` | Astro Content Collections | Doc index: card grid of all 9 docs (adr/ and plans/ excluded) |
| `/docs/[slug]` | Astro Content Collections | Rendered markdown with sidebar nav + on-this-page rail |
| `/` | `races?year=` + `races/:id` + `predictions/upcoming` + `predictions/history` + `races/:id/recap` + driver/team standings + `predictions/title-odds` | Season progress strip + three blocks: next race, last race Recap, championship top 5 with title odds |
| `/prediction` | Upcoming: `predictions/upcoming` + `sprint/upcoming` + `predictions/standings` + `predictions/model-info` · Scorecard: `predictions/history?year=N` + `predictions/accuracy` | Tabs: Upcoming · Scorecard (hit rates, best call/worst miss/streak, race by race, calibration when ≥5 races, every season) |
| `/prediction/[id]` | `predictions/race/:id` + `races/:id` + `predictions/race/:id/friday-pace` | Historical GP prediction: contribution breakdown, radar compare, Friday pace, in-browser what-if lab |
| `/prediction/sprint/[id]` | `sprint/race/:id` + `sprint/race/:id/detail` | Sprint prediction detail: same feature set, sprint model |
| `/prediction/recap[/year]` | - | 301 → `/prediction?tab=scorecard[&year=N]` (`src/middleware.ts`) |
| `/races` | `GET /api/races?year=N` | Race calendar: filter (ALL/SPRINT/GP), sort (ASC/DESC), sprint weekends as two cards |
| `/races/[id]` | `races/:id` + `predictions/race/:id` + `races/circuit/:key` + `strategy` + race-control/overtakes/team-radio | GP results, qualifying, laps, strategy, race events, circuit; links to race story + telemetry |
| `/races/[id]/sprint` | `sprint/race/:id/detail` + `races/circuit/:key` + `strategy` + race events (`session=sprint`) | Sprint results, SQ grid, sprint lap chart, conditions |
| `/races/[id]/race-story` | `races/:id` + `races/:id/race-story` | Gap/position charts, battles, weather; `?session=sprint` for the sprint |
| `/races/[id]/telemetry` | `races/:id` + `races/:id/telemetry?session=&a=&b=` | Two-lap qualifying comparison; drivers picked with a plain GET form |
| `/circuits` | `races/circuits` + `races?year=N` | Tabs: All circuits · This season |
| `/circuits/[key]` | `races/circuit/:circuitKey` + `races/circuit/:circuitKey/telemetry` + Open-Meteo | Tabs: Overview · Winners · Dominance · Telemetry |
| `/drivers` | `drivers/standings` · `predictions/title-odds` + `races` · `drivers/racecraft` | Tabs: Standings · Title fight · Racecraft |
| `/compare/drivers` | `drivers?year=N` + `seasons` + `search`; details fetched client-side | Driver head-to-head comparison page |
| `/drivers/[id]` | `drivers/:id?year=N` · `drivers/:id/teammate-battle` · `drivers/:id/career` + `drivers/:id/history` · `predictions/history` | Tabs: This season · Teammate battle · Career · Model |
| `/teams` | `teams/standings` · `predictions/title-odds` · `teams/pit-stops` | Tabs: Standings · Title odds · Pit crews |
| `/compare/teams` | `teams?year=N` + `seasons` + `search`; details fetched client-side | Team head-to-head comparison page |
| `/teams/[id]` | `teams/:id?year=N` + driver standings · `teams/:id/pit-stops` + `teams/pit-stops` · `teams/:id/career` + `teams/:id/history` | Tabs: This season · Pit crew · History |
| `/history` | `history/records` · `history/milestones` · `history/on-this-day?date=` · `history/lineages` | History: tabs Records · Milestones · On this day · Lineage (F1DB, credited) |
| `/health-quality` | `quality?year=N` + `seasons` | Dev-only data-quality dashboard |

### Key Library Files

| File | Purpose |
|------|---------|
| `lib/api.ts` | Single typed API client. All pages call functions from here: never raw `fetch`. |
| `lib/site.ts` | `SITE_NAME`: the brand string used in titles and the header. |
| `lib/f1/teamColors.ts` | Maps `team_key` strings (e.g. `red_bull`, `ferrari`) to official hex colors. Used for colored badges/dots across standings, driver pages, and result tables. |
| `lib/f1/teamLogos.ts` | Maps `team_key` to a static logo path under `/teams/`. Returns `null` for historical teams with no logo file. Used on teams index, teams detail, and drivers standings pages. |
| `features/history/f1dbCountries.ts` | `f1dbCountryFlag()` / `f1dbCountryName()`: F1DB kebab-case country ids → flag emoji (via ISO 3166 codes) and display name; used by the history leaderboards, record tiles and chases. |
| `lib/f1/championshipMath.ts` | Title contention (who is mathematically out given remaining GPs + sprints and the era's points) and title-odds formatting. |
| `components/data/chartScale.ts` / `labelLayout.ts` | Scale + tick + label-spreading primitives behind the plain-SVG `LineChart` and `StintChart` (no chart library). |
| `lib/pageTabs.ts` | `resolveTab(url, tabs)` picks the open `?tab=` (first tab when absent/unknown); `tabHref()` builds a tab link that keeps `year` etc. and drops `tab` for the default. Pages fetch only the open tab's data. |
| `lib/sidebarState.ts` | Reads/writes the `sidebar` cookie: a cookie (not localStorage) so `BaseLayout` renders the right width server-side and the layout never jumps. |
| `lib/utils.ts` | `cn()`: combines `clsx` and `tailwind-merge` for conditional class names. `unwrapSettled(result, fallback)`: one-line `PromiseSettledResult` unwrap, used wherever a page fans out `Promise.allSettled()` calls. Plus `format*` display helpers. |
| `features/history/historyView.ts` | Pure view logic for the History page: leaderboard bar widths, chase summaries, month-day stepping for On this day, lineage timeline spans and family totals; unit-tested directly. |
| `features/compare/compareReducer.ts` | Pure `compareReducer(state, action, config)`: every hydrate/year-change/selection/mode transition and stale-fetch-response guard, as one reducer with no React dependency; unit-tested directly. |
| `features/compare/useCompareController.ts` | Generic hook powering both compare tools: wraps `compareReducer` in `useReducer` plus the URL-hydrate, URL-sync, and fetch effects. Item list, A/B selection, discriminated `comparison` (season/career) result, URL sync through an injectable `locationAdapter` seam. |
| `features/search/useGlobalSearch.ts` | Hook powering `GlobalSearch`: open/close state, Cmd/Ctrl+K + Escape keyboard shortcut, `open-global-search` event bridge from the Sidebar/MobileNav search buttons, fetch-on-first-open, close-animation timing. |

---

## E2E (`apps/e2e/`)

Own package: see `docs/adr/0001-apps-layout-scoped-to-js-bun.md` for why this isn't nested under
`apps/web/`. Playwright drives a real browser against `apps/web`'s `astro dev` server; a fixture
HTTP server stands in for `apps/api` since the pages under test fetch data server-side (in Astro
frontmatter), where Playwright's own request interception can't reach.

The fixture server also needs CORS headers (`Access-Control-Allow-Origin`), even though every
other route is only ever hit server-side: `GlobalSearch`/`DriverCompareTool`/`TeamCompareTool`
fetch client-side (the sanctioned exception in the web app's data-fetching rule), so from the
browser that's a real cross-origin request to the fixture server's port, subject to the same CORS
enforcement the real Hono API's `cors()` middleware handles in production.

```
apps/e2e/
├── fixtures/
│   ├── data.ts                    # Fixture objects typed against the API's response types (type-checked in CI)
│   └── server.ts                  # Bun.serve(): serves { data, error: null } + CORS headers for the routes under test
├── tests/
│   └── smoke/
│       ├── branding.spec.ts        # /: dashboard title carries the brand exactly once
│       ├── sidebar.spec.ts         # Season/Explore groups, active destination, collapse persists across reloads
│       ├── home-hub.spec.ts        # /: exactly three blocks: next race (schedule, circuit), last race recap, championship
│       ├── global-search.spec.ts   # Cmd/Ctrl+K opens, shows results, Escape closes (client-side fetch)
│       ├── prediction.spec.ts      # /prediction tabs + Scorecard, recap URL redirect, /prediction/1 Friday pace
│       ├── sprint-prediction.spec.ts # /prediction/sprint/2: sprint prediction detail page
│       ├── race-detail.spec.ts     # /races/1: results, qualifying, prediction, incidents, overtakes tabs
│       ├── race-sprint.spec.ts     # /races/2/sprint: sprint results + prediction panel + GP ⇄ sprint links
│       ├── race-story.spec.ts      # /races/1/race-story: gap/position/battles, weather with rain spells
│       ├── telemetry.spec.ts       # /races/1 → telemetry: two qualifying laps picked in a plain GET form
│       ├── circuits.spec.ts        # /circuits: this season's circuits
│       ├── circuit-detail.spec.ts  # /circuits/monza: overview + tabs, winners facts, telemetry outline
│       ├── drivers-standings.spec.ts # /drivers: standings, title fight, racecraft tabs keep the season
│       ├── driver-detail.spec.ts   # /drivers/10: stats grid + recent results, tabs, teammate battle
│       ├── driver-compare.spec.ts  # /compare/drivers: URL-param-driven season comparison, drivers ⇄ teams switch (client-side fetch)
│       ├── teams-standings.spec.ts # /teams: standings, title odds, pit crews tabs
│       ├── team-detail.spec.ts     # /teams/1: stats + roster, history tab, pit crew tab
│       ├── teams-compare.spec.ts   # /compare/teams: URL-param-driven constructor comparison (client-side fetch)
│       └── history.spec.ts         # /history tabs (records, chases, milestones, on this day, lineage), old-URL redirects, driver/team history tabs
├── playwright.config.ts           # webServer: [fixture server, `astro dev` in ../web]
├── tsconfig.json
└── package.json
```

---

## Data Engine (`data-engine/`)

Python 3.12 (pinned via `.python-version` + `PYTHON_VERSION` in `render.yaml`) batch jobs. Fetches F1 data via
OpenF1/Jolpica (FastF1 only for the calendar and backfills), computes predictions, writes directly to Neon via psycopg2.

```
data-engine/
├── src/
│   ├── weekend_pipeline.py        # The only Race Status interpreter: plan() (what is due + when), chain()/JOBS (job chains),
│   │                              #   due_statuses()/statuses_after() (CLI auto-detect), repair_plan()/repair_steps(), SPRINT_FORMATS
│   ├── enrichment_coverage.py     # What each weekend is owed per (table, session): COVERAGES, read_coverage(), missing(),
│   │                              #   source_for(year) (FastF1 2018–2022, OpenF1 2023+), CONFLICT_KEYS, normalize_compound()
│   ├── auto_runner.py             # Runs weekend_pipeline chains on the worker cycle; reverts status on failure.
│   │                              # Schedule-gated: skips the DB entirely outside a race-weekend window;
│   │                              # retries only the (table, session) gaps enrichment_coverage.missing() reports
│   ├── server.py                  # HTTP server: login-gated live dashboard + HEAD health check for UptimeRobot;
│   │                              # worker loop polls ~20 min in-window, ~6 h otherwise
│   ├── dashboard.py               # Renders the /login and status-dashboard HTML (styled to match apps/web)
│   ├── main.py                    # CLI entry point: --job, --year, --round, --race_id, --session (Race|Sprint), --all, --resolve_run
│   │                              # auto_detect_round(job, year): the round in a status weekend_pipeline says the job is due in
│   ├── config.py                  # FastF1 cache setup, environment loading
│   ├── db/
│   │   ├── client.py              # get_conn(): psycopg2 RealDictCursor connection
│   │   └── __init__.py
│   ├── jobs/
│   │   ├── sync_schedule.py            # Populate races table: includes sprint_date, event_format; renumber-safe (matches by event name)
│   │   ├── sync_season.py              # Populate teams + drivers from a round's OpenF1 entry list
│   │   ├── ingest_qualifying.py        # Q1/Q2/Q3 + sector times: 2018+; date guard rejects future rounds
│   │   ├── ingest_qualifying_legacy.py # Qualifying from Ergast: pre-2018
│   │   ├── ingest_race.py              # Race results + lap times + conditions + race story (traces/battles/weather): 2018+
│   │   ├── ingest_race_story.py        # Race story alone (traces/battles/weather): worker retry when ingest_race skipped it under the storage tier
│   │   ├── ingest_race_control.py      # OpenF1 race-control messages → race_control_messages; _to_rows() over run_openf1_job (ingest_runner.py)
│   │   ├── ingest_overtakes.py         # OpenF1 overtakes → race_overtakes; _to_rows() resolves driver_number via the driver_map run_openf1_job passes in
│   │   ├── ingest_team_radio.py        # OpenF1 team radio → team_radio_clips; same driver_number resolution, empty/partial results are normal
│   │   ├── ingest_stints.py            # OpenF1 /stints → race_stints over run_openf1_job
│   │   ├── ingest_pit_stops.py         # OpenF1 /pit → race_pit_stops over run_openf1_job (stationary time from 2024 US GP on)
│   │   ├── ingest_qualifying_telemetry.py # OpenF1 laps/car_data/location → qualifying_lap_telemetry (fastest Q/SQ lap per driver);
│   │   │                              #   resumable across cycles under the OpenF1 request budget, storage-guarded; run() returns False while unfinished
│   │   ├── ingest_race_legacy.py       # Race results from Ergast (no laps): pre-2018
│   │   ├── ingest_sprint_qualifying.py # SQ session → sq1/sq2/sq3 + sector times + speed; messages=True; date guard
│   │   ├── ingest_fp2.py               # Practice long-run stint data → fp2_long_run_times (FP2 primary; FP1 fallback on sprint weekends)
│   │   ├── ingest_sprint.py            # Sprint results + sprint_lap_times + sprint conditions
│   │   ├── compute_season_stats.py     # Aggregate driver/team stats including sprint aggregates
│   │   ├── compute_title_odds.py       # Monte Carlo title odds after the latest completed round → title_odds_drivers/teams (seeded, idempotent);
│   │   │                              #   run(year, after_round) replays an earlier round (later races still to run)
│   │   ├── compute_features.py         # weighted-v4 Prediction: committed fit → features JSONB, probabilities, winner in one transaction
│   │   ├── compute_sprint_features.py  # Sprint feature_runner spec: 8 sprint feature scores per driver
│   │   ├── compute_sprint_predictions.py # Softmax (T=0.3) on sprint scores → sprint win probabilities
│   │   ├── import_f1db.py              # Import an extracted F1DB release → history_* tables (weekly GitHub Action or local; skips imported versions)
│   │   ├── data_quality_audit.py        # Per-table completeness/coverage audit → data_quality_runs/issues
│   │   └── data_quality_repair.py       # Re-ingests data for fixable audit issues via weekend_pipeline.repair_plan()
│   ├── models/
│   │   └── gp_v4.json             # weighted-v4's fitted weights (written by scripts/fit_model_v4.py, committed, ADR 0010)
│   └── utils/
│       ├── fastf1_helpers.py      # get_session(), ms_to_int(), session_to_lap_records(), session_weather_trace(): local pre-2023 backfills only
│       ├── openf1_session.py      # load_session() + race_results(), qualifying_results(), lap_times(), lap_records(), safety_car_laps(),
│       │                          # weather_label/details(), is_complete(): OpenF1 + Jolpica → the ingest row shapes (ADR 0011)
│       ├── jolpica_client.py      # fetch_classification(): Jolpica race/sprint results (grid, status, points, times)
│       ├── feature_manifest.py    # SPRINT_FEATURES (name, weight, label, nullable): the sprint model's hand weights;
│       │                          # SPRINT_WEIGHTS + assemble_scores() + SPRINT_SOFTMAX_TEMPERATURE; checked against docs/feature-weights.json
│       ├── math_utils.py          # normalize_minmax(), softmax(), bayesian_win_rate(), clamp(), weighted_sum()
│       ├── upsert.py              # upsert(conn, table, rows, conflict_cols, exclude_update=[])
│       ├── driver_map.py          # build_driver_code_map(), build_driver_number_map(conn, season_id): shared driver code/number→id lookups for ingest jobs
│       ├── driver_registry.py     # session_entries(), register_session_drivers(): adds a session's missing drivers/teams before results are mapped
│       ├── f1db.py                # normalize_person_name() (join key with apps/api common/identity.ts f1dbPersonKey), career_milestones(), driver_row(),
│       │                          # constructor_row(), constructor_seasons(): F1DB release → history_* rows
│       ├── f1db_results.py        # match_f1db_driver(), race_row(), qualifying_row(): F1DB record → our rows
│       ├── f1db_backfill.py       # plan_season(): pure diff of one season vs F1DB (codes, new drivers, merges, rows)
│       ├── openf1_client.py       # get_session_key(), find_weekend_session_key(), fetch_session_data(), fetch_race_control/overtakes/team_radio/stints/pit_stops/laps/car_data/location()
│       │                          # over one shared _get(): paced + per-cycle request budget (OpenF1BudgetExceeded), free tier only
│       ├── race_story.py          # build_lap_traces(), find_battles(), weather_trace(): pure race-story shaping from lap records
│       ├── telemetry.py           # fastest_laps(), build_lap_telemetry(): resample a lap onto a 10 m distance grid; telemetry_samples(): JSONB shape
│       ├── fastf1_enrichment.py   # stint_rows(), pit_stop_rows(), race_control_rows(), telemetry_inputs(): FastF1 → the OpenF1-shaped tables (2018–2022)
│       ├── title_odds.py          # Plackett-Luce finishing-order sampling + season simulation → title odds (ADR 0007)
│       ├── storage_guard.py       # storage_tier()/read_storage_tier(): Neon Free 1 GB tiers gating optional writes + backfills
│       ├── logging_utils.py       # log_job_failure(), log_job_ok(), peak_rss_mb(): structured JSON job logs
│       ├── conditional_logit.py   # LogitModel + fit_conditional_logit(): softmax over coef · standardized features, fitted by max likelihood
│       ├── gp_features_v4.py      # gp_features(history, race_id): weighted-v4's features in real units, from races before this one only
│       ├── gp_model_v4.py         # the GP model: training_races() → fit(before=) → predict(); load_committed()/save_model() for src/models/gp_v4.json
│       ├── race_history.py        # RaceHistory + load_history(conn, since, until): the in-memory slice the v4 features read
│       ├── identity.py            # person_key(), is_same_person(), constructor_key(): mirrors apps/api common/identity.ts
│       ├── season_aggregates.py   # Driver/team season aggregates, optionally as of a race date (season stats + sprint features)
│       ├── backtest.py            # race_metrics() (log loss, Brier, top-1/3), calibration_table(), GridWinRates baseline
│       ├── prediction_runner.py   # run_prediction_job(...): shared softmax/rank/upsert logic for GP + sprint predictions
│       ├── feature_runner.py      # run_feature_job(spec, race_id): context, car performance, scoring, weighting and upsert
│       │                          #   for the sprint feature job; FeatureJobSpec is all a model supplies
│       ├── ingest_runner.py       # Three seams: run_ingest_job(...), shared headshot/results/lap-time/race-story/status logic for
│       │                          # ingest_race + ingest_sprint; run_qualifying_ingest_job(...): shared logic for
│       │                          # ingest_qualifying + ingest_sprint_qualifying (no weather/laps/headshots);
│       │                          # run_openf1_job(...): shared resolve/guard/upsert logic for the OpenF1-sourced jobs
│       │                          # (race control, overtakes, team radio, stints, pit stops); each supplies only a
│       │                          # table, conflict_cols, a fetch(session_key) callable, and a to_rows() shaping callable
│       ├── feature_helpers.py     # Sprint-v2 scoring math: compute_weather_score(),
│       │                          # compute_luck_score(), circuit_adj_start_pos(), compute_rolling_teammate_delta(),
│       │                          # compute_team_circuit_perf()/blend_car_perf() (circuit-category car performance)
│       ├── feature_context.py     # build_feature_context(): shared query/assembly scaffolding (race+circuit row,
│       │                          # grid map, start_pos, driver/team season stats) behind the sprint feature job
│       ├── quality_utils.py       # health_from_issues() + is_fixable() (derived from weekend_pipeline.repair_steps)
│       └── schedule_window.py     # race_weekend_window(): pure race-weekend window from the FastF1 calendar, no DB
├── scripts/                       # One-off/operational scripts: not imported by src/
│   ├── run_backfill.py            # Full historical backfill runner: sync + ingest (incl. Ergast legacy jobs) + compute, per year range
│   ├── backfill_full.py           # Full historical backfill: sync + ingest + sprint + predictions
│   ├── backfill_sprint.py         # Sprint-only backfill for specific years
│   ├── backfill_fp2.py            # Backfill FP2 long-run data for 2018+ completed races
│   ├── backfill_openf1.py         # Backfill any OpenF1 job (race control, overtakes, radio, stints, pit stops) for a year range: 2023+, local only,
│   │                              #   skips covered races unless --refresh, stops at the storage guard
│   ├── backfill_fastf1_enrichment.py # Stints, pit stops, race control, Q telemetry for 2018–2022 from FastF1 [--only] [--refresh]: local only, skips covered races
│   ├── backfill_title_odds.py     # Replay title odds after every completed round for a year range (default 2018–2026)
│   ├── backfill_race_story.py     # Backfill race_lap_traces/battles/weather for completed 2018+ races: FastF1, local only
│   ├── backfill_all_predictions.py # Regenerate GP (weighted-v4, fitted per season on earlier seasons) + sprint-v2 predictions: local only
│   ├── backfill_historical.sh     # Shell loop over sync_schedule/ingest/compute for a year range
│   ├── backtest.py                # Walk-forward GP backtest on the local snapshot: CANDIDATES vs grid-history/uniform baselines
│   ├── backtest_snapshot.py       # Copy Neon into the local backtest Postgres (docker-compose.backtest.yml); read-only on Neon
│   ├── fit_model_v4.py            # Refit weighted-v4 on the snapshot → src/models/gp_v4.json + importances in docs/feature-weights.json
│   ├── f1db_release.py            # Download + SHA-256-verify + extract an F1DB release (shared by the scripts below)
│   ├── import_f1db.py             # Import F1DB all-time history tables (weekly via .github/workflows/f1db-import.yml, or local)
│   ├── audit_results_vs_f1db.py   # Read-only: every race's results vs F1DB; --modern-plan lists 2018+ races to re-ingest
│   ├── backfill_results_from_f1db.py # Rebuild 1980–2017 results/drivers from F1DB (ADR 0009): dry run unless --apply
│   └── populate_all.sh            # One-time population run for 2021–2025
├── tests/                          # pytest: pure functions directly; DB-touching functions via a fake-db double
│   ├── conftest.py                 # Placeholder DATABASE_URL so importing job modules doesn't need a real .env
│   ├── support/
│   │   ├── fake_db.py              # FakeCursor/FakeConnection: scripted RealDictCursor-shaped rows, no real DB
│   │   ├── race_history.py         # sample_history(): a small in-memory RaceHistory for the v4 feature, model and job tests
│   │   ├── f1db_fixtures.py        # Loads tests/fixtures/f1db/*.json (trimmed real F1DB records)
│   │   └── openf1_fixtures.py      # Loads tests/fixtures/openf1/*.json (recorded Monza 2024/2025, Bahrain 2026 responses)
│   ├── fixtures/{f1db,openf1,jolpica}/  # Recorded JSON fixtures
│   ├── test_math_utils.py          # normalize_minmax, softmax, bayesian_win_rate, clamp, weighted_sum
│   ├── test_quality_utils.py       # health_from_issues + is_fixable
│   ├── test_weekend_pipeline.py    # plan() per status/format + readiness, chains, due_statuses, repair_plan: pure
│   ├── test_enrichment_coverage.py # missing(), source_for(), compound normalisation across sources, coverage query via fake_db
│   ├── test_feature_runner.py      # sprint feature job pinned end to end: via fake_db + monkeypatched execute_batch
│   ├── test_compute_features.py    # weighted-v4 job: one transaction, stale drivers dropped, in-sample races skipped, stored p = backtest p
│   ├── test_conditional_logit.py   # fit recovers known weights from simulated races, field probabilities
│   ├── test_gp_features_v4.py      # quali/long-run/pace gaps, neutralisation rate, decayed form, gp_features, load_history
│   ├── test_gp_model_v4.py         # gp_v4.json save/load, importance percentages, training set
│   ├── test_identity.py            # person_key/is_same_person/constructor_key against docs/identity-cases.json
│   ├── test_backtest.py            # race metrics, summarize, paired difference, calibration table, GridWinRates
│   ├── test_main_cli.py            # CLI dispatch: --job wiring incl. ingest_race_story
│   ├── test_feature_helpers_pure.py # car_rank, circuit_adj_start_pos
│   ├── test_feature_helpers_db.py  # compute_weather_score, compute_luck_score: via fake_db
│   ├── test_feature_context.py     # build_feature_context, build_driver_code_map, build_driver_number_map: via fake_db
│   ├── test_circuit_perf.py        # compute_team_circuit_perf: category normalisation, min races, speed-trap blend
│   ├── test_season_stats_db.py     # driver/team season aggregates incl. DNF rate, sprint points: via fake_db
│   ├── test_fastf1_helpers.py      # ms_to_int, session_to_lap_records, session_weather_trace
│   ├── test_openf1_session.py      # OpenF1 + Jolpica → ingest rows on recorded Bahrain 2026 (accurate laps, SC/VSC, results, quali)
│   ├── test_jolpica_client.py      # fetch_classification: race vs sprint endpoint, unpublished, retries
│   ├── test_weights.py             # sprint WEIGHTS sum-to-1 + positivity, assemble_scores() key-drift guard; sprint weights and
│   │                                #   GP importances (vs gp_v4.json) checked against docs/feature-weights.json
│   ├── test_prediction_ranking.py  # rank_by_probability
│   ├── test_prediction_runner.py   # run_prediction_job: via fake_db + monkeypatched execute_batch
│   ├── test_upsert.py              # upsert() param shape + no-op-on-empty: via fake_db + monkeypatched execute_batch
│   ├── test_schedule_window.py     # race_weekend_window + RaceWeekendWindow.contains
│   ├── test_auto_runner.py         # run_cycle() schedule gate, revert-on-failure, poll_interval_for_window (jobs swapped in weekend_pipeline.JOBS),
│   │                                #   per-table retry reruns, memo settling, budget-limited telemetry stays pending
│   ├── test_ingest_runner.py       # run_ingest_job + run_qualifying_ingest_job + run_openf1_job (guards, driver_map pass-through): via fake_db + monkeypatched openf1_session
│   ├── test_ingest_fp2.py          # FP2 vs FP1 choice, long_run_rows() (runs split at pit visits, best median per compound)
│   ├── test_ingest_race_control.py # _to_rows() pure-function shaping + run() config-wiring check
│   ├── test_ingest_overtakes.py    # _to_rows() pure-function shaping incl. unknown-driver-number skipping + run() config-wiring check
│   ├── test_ingest_team_radio.py   # _to_rows() pure-function shaping incl. unknown-driver-number skipping + run() config-wiring check
│   ├── test_ingest_stints.py       # _to_rows() on recorded Monza 2024 stints + run() config wiring
│   ├── test_ingest_pit_stops.py    # _to_rows() stationary ms (2025) vs none (pre-2024 US GP) + run() config wiring
│   ├── test_ingest_qualifying_telemetry.py # fastest lap per driver, skip stored drivers, partial write on budget exhaustion
│   ├── test_openf1_client.py       # get_session_key (date match incl. 1-day drift, pre-2023 no-coverage), find_weekend_session_key, fetch_* endpoints
│   ├── test_race_story.py          # lap traces (gap to leader, interval, lapped cars, positions), battles, weather trace
│   ├── test_telemetry.py           # fastest_laps, 10 m resampling against the official lap time
│   ├── test_fastf1_enrichment.py   # FastF1 stint/pit/race-control converters (red-flag waits dropped), telemetry input reshaping
│   ├── test_title_odds.py          # finishing-order sampling + title simulation invariants
│   ├── test_compute_title_odds.py  # run() writes driver + team odds for the latest completed round; after_round replay ignores later results
│   ├── test_storage_guard.py       # storage tiers vs Neon Free 1 GB, what each tier allows
│   ├── test_data_quality_audit.py  # _audit_race gate/threshold branching per race status: via fake_db
│   ├── test_data_quality_repair.py # run() audit-run selection, one repair plan per race through weekend_pipeline.JOBS, resolve/rollback
│   ├── test_main_auto_detect.py    # auto_detect_round(job): due statuses per job, row→(year,round), exit(1) closes the connection
│   ├── test_sync_schedule.py       # _to_utc_iso + run() circuit-key resolution (Madrid/Spielberg year overrides), status-preserving upsert, round renumbering
│   ├── test_sync_season.py         # run() hands the round's drivers to the registry, refreshing known ones
│   ├── test_driver_registry.py     # OpenF1 session entries (code fallbacks, team keys) + registering missing drivers/teams
│   ├── test_f1db.py                # normalize_person_name, career_milestones, driver_row
│   ├── test_import_f1db.py         # run() imports drivers/constructors/lineage, skips already-imported releases
│   ├── test_f1db_results.py        # F1DB driver matching (accents, surname, aliases) + race/qualifying row building
│   ├── test_f1db_backfill.py       # plan_season: stand-ins sharing a number, NAN codes, merges, wrong-driver deletes
│   └── test_compute_sprint_features.py # _compute_short_run_pace SQ-time source, main-quali fallback, min-max inversion
├── docker-compose.backtest.yml    # Local Postgres (:5434) holding the Neon snapshot scripts/backtest.py replays
├── render.yaml                    # Render web service: `python -m src.server` (worker loop + dashboard), PYTHON_VERSION 3.12.8
├── .python-version                # 3.12.8
├── requirements.txt               # Python dependencies
├── requirements-dev.txt           # requirements.txt + pytest
├── pyproject.toml                 # pytest config (pythonpath, testpaths)
└── .env.example                   # DATABASE_URL template
```

### Jobs

| Job | Input | Purpose |
|-----|-------|---------|
| `sync_schedule` | `--year` | Populates `races` table with sprint dates and event_format |
| `sync_season` | `--year [--round]` | Populates `teams` and `drivers` from one round's OpenF1 entry list; ingests register later arrivals themselves |
| `ingest_qualifying` | `--year --round` | Q1/Q2/Q3 times, sector times, grid positions: 2018+ |
| `ingest_qualifying_legacy` | `--year --round` | Grid positions and Q times via Ergast: pre-2018; run via `scripts/run_backfill.py` (not a `main.py` job) |
| `ingest_race` | `--year --round` | Race results + per-lap timing + conditions + race story (traces, battles, weather): 2018+ |
| `ingest_race_legacy` | `--year --round` | Race results only via Ergast: pre-2018; run via `scripts/run_backfill.py` (not a `main.py` job) |
| `ingest_sprint_qualifying` | `--year --round` | SQ session → sprint_results (sq1/sq2/sq3 + sector times + speed); date guard rejects future rounds |
| `ingest_fp2` | `--year --round` | Practice long-run stints → `fp2_long_run_times` (FP2 primary, FP1 fallback on sprint weekends); shown as the Friday pace table |
| `ingest_sprint` | `--year --round` | Sprint results + sprint_lap_times + sprint conditions; sprint weekends only |
| `ingest_race_control` | `--year --round [--session]` | OpenF1 flags/SC/VSC/incident messages: completed races only, 2023+ (no OpenF1 coverage before; 2018–2022 backfilled from FastF1), gated past OpenF1's live window |
| `ingest_overtakes` | `--year --round [--session]` | OpenF1 on-track overtakes: same 2023+/completed/live-window gating; skips rows whose driver number can't be resolved |
| `ingest_team_radio` | `--year --round [--session]` | OpenF1 team radio clips: same 2023+/completed/live-window gating; F1 doesn't release radio for every session, so a partial or empty result is normal |
| `ingest_stints` | `--year --round [--session]` | OpenF1 tyre stints → `race_stints`: same gating (2018–2022 backfilled from FastF1) |
| `ingest_pit_stops` | `--year --round [--session]` | OpenF1 pit stops → `race_pit_stops`: same gating; stationary time only from the 2024 US GP (2018–2022 backfilled from FastF1, pit-lane time only) |
| `ingest_qualifying_telemetry` | `--year --round [--session Race\|Sprint]` | Fastest Q (or SQ) lap telemetry per driver → `qualifying_lap_telemetry`; resumable, budget- and storage-guarded (2018–2022 backfilled from FastF1) |
| `ingest_race_story` | `--year --round --session` | Race story alone for a race whose `ingest_race` skipped it under the storage tier |
| `compute_season_stats` | `--year` | Rolling aggregates for drivers and teams, including sprint stats |
| `compute_title_odds` | `--year` | Monte Carlo driver/team title odds after the latest completed round; `scripts/backfill_title_odds.py` replays every earlier round |
| `compute_features` | `--race_id` | weighted-v4 Prediction for a GP: 7 features (value + contribution), win probabilities, predicted winner |
| `compute_sprint_features` | `--race_id` | 8 sprint feature scores per driver |
| `compute_sprint_predictions` | `--race_id` | Softmax (T=0.3) → sprint win probabilities and predicted positions |
| `data_quality_audit` | `[--year] [--all]` | Completeness/coverage audit → `data_quality_runs`/`data_quality_issues` |
| `data_quality_repair` | `[--year] [--resolve_run]` | Re-runs the fixable audit issues' jobs and resolves them |
| `import_f1db` | via `scripts/import_f1db.py [--version]` | F1DB release → `history_*` tables; weekly GitHub Action (`f1db-import.yml`) or local, storage-guarded (not a `main.py` job) |

### Utilities

| File | Key functions |
|------|--------------|
| `openf1_session.py` | `load_session(year, race_date, session_type, parts)`: finds the weekend by `races.race_date` and fetches only the parts a job needs; `race_results(session, classification)` (Jolpica grid/status/points/times + OpenF1 fastest lap and headshots), `qualifying_results()`, `lap_times()` (FastF1 `pick_accurate()` rules: green-flag laps from `neutralisations()`), `lap_records()` (running order by line-crossing time), `safety_car_laps()`, `weather_label()`/`weather_details()`/`session_weather_trace()`, `is_complete()` (ADR 0011) |
| `jolpica_client.py` | `fetch_classification(year, round, sprint=False)`: Jolpica `Results`/`SprintResults`, empty until published |
| `fastf1_helpers.py` | FastF1 readers kept for the local pre-2023 backfills (`backfill_race_story.py`, `backfill_fastf1_enrichment.py`, the `_legacy` jobs): `get_session()`, `ms_to_int()`, `session_to_lap_records()`, `session_weather_trace()` |
| `feature_manifest.py` | `SPRINT_FEATURES: tuple[FeatureSpec, ...]` (name, weight, label, nullable): the sprint model's hand weights; `SPRINT_WEIGHTS` and `SPRINT_SOFTMAX_TEMPERATURE` live beside it; `assemble_scores(values, features)` raises `KeyError` if a manifest feature's score was never computed. Checked against `docs/feature-weights.json` (also read by `apps/web`'s `predictionMath.test.ts`) so Python and TS weights can't silently drift. The GP model has no hand weights (`src/models/gp_v4.json`) |
| `math_utils.py` | `normalize_minmax(values)`: min-max to [0,1]; `softmax(scores, temperature=1.0)`: plain by default, sprint passes T=0.3; `bayesian_win_rate(wins, races)`: Laplace smoothed; `clamp(value)`; `weighted_sum(scores, weights)`: dot product of a feature-score dict against a model's `WEIGHTS` dict, used by `feature_runner` |
| `conditional_logit.py` / `gp_model_v4.py` | `fit_conditional_logit()` (damped Newton, L2 on standardized features) → `LogitModel` (`probabilities()`, `contributions()`); `training_races()` → `fit(before=)` → `predict()`, the only path to a GP Prediction (live job, backfill, fit script, backtest); `load_committed()`/`save_model()` for `src/models/gp_v4.json`, `importance_percentages()` (ADR 0010) |
| `gp_features_v4.py` / `race_history.py` | `gp_features(history, race_id)`: grid, quali_pace, team_quali_pace, driver_points, teammate_edge, grid_processional, team_race_pace (plus backtest-only candidates) from an in-memory `RaceHistory` (`load_history(conn, since, until)`) |
| `season_aggregates.py` | Driver/team season aggregates shared by `compute_season_stats` and the sprint features; `before=` limits them to races before a date so a recomputed prediction can't see its own result |
| `backtest.py` | Scoring for `scripts/backtest.py`: `race_metrics()`, `summarize()`, `paired_difference()`, `calibration_table()`, `GridWinRates` (P(win \| grid slot) from earlier races) |
| `upsert.py` | `upsert(conn, table, rows, conflict_cols, exclude_update=[])`: idempotent bulk write; `exclude_update` prevents overwriting specified columns (used to protect sprint race data from SQ re-ingest) |
| `feature_helpers.py` | Sprint-v2 scoring math: `compute_weather_score()`, `compute_luck_score()`, `circuit_adj_start_pos()`, `compute_rolling_teammate_delta()`, `compute_team_circuit_perf()` |
| `feature_context.py` | `build_feature_context(conn, race_id, grid_table=..., grid_not_found_message=..., validate_race=None)`: shared query/assembly scaffolding used by `feature_runner`: race+circuit row, grid map, per-driver starting position, driver season stats, team perf/reliability |
| `prediction_runner.py` | `run_prediction_job(...)`: shared softmax/rank/upsert logic for GP + sprint predictions; `rank_by_probability(driver_ids, probabilities)`, pure position-ranking + winner-pick, extracted so it's unit-testable without a DB connection |
| `ingest_runner.py` | Three seams, matched to three different session shapes (see the module docstring for why they're not one). `run_ingest_job(year, round, IngestJobConfig)`: full race/sprint session (weather, SC/VSC, results, lap times, headshots, race story when storage allows); `IngestJobConfig.mark_status` writes the job's own `races` row, an optional `cross_table_hook` runs after it for effects on other tables (e.g. `ingest_race`'s `circuits.sc_probability` recompute). `run_qualifying_ingest_job(year, round, QualifyingJobConfig)`: qualifying-only session (just quali times, no weather/laps/headshots); `QualifyingJobConfig.rows_from_quali` is the per-job typed `session → rows` function used by `ingest_qualifying`/`ingest_sprint_qualifying`. `run_openf1_job(year, round, OpenF1JobConfig, session_name=...)`: the shared resolve-race/completed-guard/live-window-guard/storage-guard/upsert/commit shape behind the five OpenF1-sourced jobs; `OpenF1JobConfig.fetch(session_key)` calls the right `openf1_client` function, `to_rows(raw, race_id, driver_map)` shapes rows and returns `(rows, skipped_count)`, `driver_map` (built once via `build_driver_number_map`) is always passed even to configs that ignore it |
| `openf1_client.py` | `get_session_key()`, `find_weekend_session_key(year, race_date, names)` + one `fetch_*()` per OpenF1 endpoint over a shared paced `_get()`; a per-cycle request budget raises `OpenF1BudgetExceeded` (ADR 0004) |
| `race_story.py` | `build_lap_traces()` (gap to leader, interval, position, laps down), `find_battles()` (3+ laps within 1.0 s), `weather_trace()` |
| `telemetry.py` | `fastest_laps()`, `build_lap_telemetry()`: resample a lap onto a 10 m grid for `qualifying_lap_telemetry` (ADR 0008); `telemetry_samples()` shapes the JSONB `samples` for both the OpenF1 job and the FastF1 backfill |
| `fastf1_enrichment.py` | FastF1 → OpenF1-shaped rows for 2018–2022: `stint_rows()`, `pit_stop_rows()` (pit-lane time only, visits over 120 s dropped as red-flag waits), `race_control_rows()`, `telemetry_inputs()`; pure converters over plain records, `session_*` helpers do the DataFrame step |
| `title_odds.py` | `simulate_title_odds()`: Plackett-Luce finishing orders sampled from win probabilities, season totals summarised into title probability + P10/P90 points (ADR 0007) |
| `storage_guard.py` | `read_storage_tier(conn)` → `StorageTier` (`allows_optional`, `allows_backfill`) against Neon Free's 1 GB: gates race story, OpenF1 enrichment, telemetry, F1DB import and backfills |
| `f1db.py` / `f1db_results.py` / `f1db_backfill.py` | F1DB release → `history_*` rows; F1DB → our race/qualifying rows; per-season backfill plan (ADR 0009) |
| `schedule_window.py` | `race_weekend_window(schedule, now)` → `RaceWeekendWindow \| None`: the current/next GP's window (FP1−1h … race+24h) derived purely from the FastF1 calendar, no DB; `RaceWeekendWindow.contains(now)`. Used by `auto_runner` to gate all DB access and to size the worker's poll interval |

---

## Docs (`docs/`)

| File | Content |
|------|---------|
| `architecture.md` | Monorepo layout, ASCII system diagram, data flow through a race weekend |
| `data-pipeline.md` | Job descriptions, required chain order, worker schedule, local commands, backfill, idempotency |
| `database-schema.md` | Every table with all columns, types, and notes; ER-style relationship diagram |
| `prediction-model.md` | GP `weighted-v4` (fitted, 7 features) and sprint `sprint-v2` weights, softmax, backtest, data availability by era |
| `rulebased-architecture.md` | Per-feature inventory of the hand-weighted models: sprint-v2 today, the retired GP weighted-v3 |
| `api-reference.md` | All endpoints with query params, response shapes, error codes |
| `frontend.md` | Astro SSR app: stack, server-only data-fetch rule + 3 exceptions, `components/` vs `features/`, routes, styling, file-size budget |
| `deployment.md` | Env vars for all three platforms, CORS config, first-time setup, local dev |
| `testing.md` | The five suites (pytest, api unit/integration, web vitest, e2e Playwright): what each covers, how to run, CI jobs |
| `feature-weights.json` | Canonical GP importances + labels, sprint weights + labels and `sprint_softmax_temperature`: checked by `test_weights.py` (GP importances against `gp_v4.json`), `predictionMath.test.ts` and the API's `feature-manifest.test.ts` (labels) |
| `plans/intelligence-platform-roadmap.md` | Intelligence-platform roadmap + free-tier budget rules (Neon, Render, OpenF1) |
| `adr/0000`–`0010` | Legacy decisions; apps/ layout; DNF incl. DSQ/DNS; local-Postgres integration tests; OpenF1 pacing/budget; edge-cached responses; race events `session_type`; Plackett-Luce title odds; telemetry as resampled JSONB; drivers unique per person + pre-2018 results from F1DB; GP model as a fitted conditional logit |

---

## Claude Skills (`.claude/skills/`)

| Skill | Purpose |
|-------|---------|
| `commit/` | Conventional commit format, domain scopes, and workflow. Always read before committing. |
| `build/` | Build verification runbook |
| `backfill/` | Historical backfill runbook and checklist |
| `performance-check/` | Audits N+1 queries, sequential awaits, per-row ETL loops, missing indexes |
| `codebase-audit/` | Health check against CLAUDE.md critical constraints, schema drift, `any` types |
| `refactor-hunt/` | Finds duplication, especially GP/sprint pipeline drift |
| `codebase-cleanup/` | Removes dead code, unused imports, orphaned migrations |
