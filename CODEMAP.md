# F1 Prediction — Code Map

Complete directory structure and file reference for the codebase.

## Project Structure

```
F1-prediction/
├── CLAUDE.md              # Agent guidelines, constraints, and project conventions
├── CODEMAP.md             # This file — codebase structure reference
├── CONTRIBUTING.md        # Contribution guidelines
├── CONTEXT.md             # Domain glossary — ubiquitous language for the project
├── README.md              # Project overview and getting started
├── LICENSE                # GPL-3.0
├── docs/                  # Project documentation
│   ├── architecture.md    # System diagram and layer connections
│   ├── data-pipeline.md   # ETL job chain, cron schedule, backfill
│   ├── database-schema.md # All tables, columns, and relationships
│   ├── prediction-model.md# Feature weights, scoring formula, softmax
│   ├── rulebased-architecture.md # Per-feature inventory of the weighted-v3 predictor
│   ├── api-reference.md   # All endpoints, params, and response shapes
│   ├── frontend.md        # Astro app — routing, server-only fetch rule, component layout
│   ├── deployment.md      # Env vars, Cloudflare setup, first-time steps
│   ├── testing.md         # The five test suites — coverage, how to run, CI
│   └── adr/               # Numbered architectural decision records
│       ├── 0000-legacy-decisions.md # Consolidated pre-ADR decisions and rationale
│       └── ...             # 0001+ — one decision per file going forward
├── apps/                  # JS/Bun-only convention — orchestrated by root package.json, no workspaces
│   ├── api/               # Hono REST API — Cloudflare Workers; also owns Drizzle schema + migrations
│   ├── web/               # Astro SSR frontend — Cloudflare Pages
│   └── e2e/               # Playwright smoke tests for apps/web — own package.json + playwright.config.ts
├── data-engine/           # Python ETL batch jobs — Render (outside apps/: no dev server, one-shot jobs)
└── .claude/skills/        # Claude Code skill definitions
    ├── commit/            # Conventional commit format and workflow
    ├── build/             # Build verification skill
    └── backfill/          # Historical backfill runbook
```

---

## API (`apps/api/`)

Hono on Cloudflare Workers. NestJS-style module structure.
Must use `@neondatabase/serverless` (HTTP driver) — no TCP in Workers.

```
apps/api/
├── src/
│   ├── main.ts                    # Entry point — registers CORS, logger, modules
│   ├── common/types.ts            # Bindings + all response types
│   ├── common/constants.ts        # SPRINT_FORMATS — single source of truth shared by all services
│   ├── common/mappers.ts          # toDriver(), toTeam(), toRace(), toCircuit(), toRaceResult(), toQualifyingResult(), toSprintResult() — canonical row→DTO mappers used by all services
│   ├── common/openf1-mappers.ts   # toRaceControlMessage(), toRaceOvertake(), toTeamRadioClip() — split out from mappers.ts once the OpenF1-sourced DTOs pushed it over the 150-line budget
│   ├── common/standings.ts        # resolveSeason(), buildStandings(), buildCareerStats(), sortByChampionshipStanding() — shared standings/career-stats pipeline for drivers, teams, predictions; drivers/teams pass a StatsAdapter (entityId/statsEntityId/toStats/emptyStats) instead of loose lambdas
│   ├── common/prediction-response.ts  # buildPredictionResponse(db, config) — shared GP/sprint prediction pipeline (winner lookup, feature mapping, response assembly); used by predictions.service.ts + sprint.service.ts
│   ├── common/prediction-history.ts   # buildHistoryItems(), buildWinnerMap(), buildProbPosMaps(), mergeHistoryByDateDesc() — pure GP/sprint prediction-history assembly for predictions.service.findHistory()
│   ├── common/cache.ts             # cacheControlForStatus(), cacheControlForYear() — Cache-Control header rules for completed vs in-progress races
│   ├── common/driverIdentity.ts    # personKey(), isSamePerson() — links one person's season-scoped driver rows (career, search)
│   ├── common/accuracy.ts          # aggregateAccuracyBySeason() — groups PredictionHistoryItem[] into per-season gp/sprint/overall accuracy buckets
│   ├── common/featureManifest.ts   # GP_FEATURE_MANIFEST/SPRINT_FEATURE_MANIFEST (key, column, label, nullable) +
│   │                               #   mapFeatureRow() — weight-less local manifest (apps/api never computes with
│   │                               #   weights); derives toFeatures()/toSprintFeatures() and intel-standings.helpers.ts's
│   │                               #   aggregation columns from one place instead of three
│   ├── config/database.ts         # createDb() — Drizzle over Neon HTTP driver
│   ├── db/
│   │   ├── schema/                # Drizzle table definitions (source of truth)
│   │   │   ├── index.ts           # Re-exports all schemas
│   │   │   ├── seasons.ts
│   │   │   ├── circuits.ts
│   │   │   ├── teams.ts
│   │   │   ├── drivers.ts
│   │   │   ├── races.ts           # Includes sprint condition columns + event_format
│   │   │   ├── qualifying_results.ts
│   │   │   ├── race_results.ts
│   │   │   ├── race_control_messages.ts  # OpenF1 flags/SC/VSC/incident log per race (free/historical only, no live data)
│   │   │   ├── race_overtakes.ts  # OpenF1 on-track overtakes per race — two driver FKs (overtaking/overtaken)
│   │   │   ├── team_radio_clips.ts  # OpenF1 team radio audio URLs per race — one driver FK; coverage is inherently patchy (F1 doesn't release every clip)
│   │   │   ├── lap_times.ts
│   │   │   ├── sprint_results.ts  # Sprint finish + SQ1/SQ2/SQ3 times + sq sector times
│   │   │   ├── sprint_lap_times.ts# Per-lap sprint data
│   │   │   ├── driver_season_stats.ts  # Includes sprint aggregates
│   │   │   ├── team_season_stats.ts
│   │   │   ├── race_predictions.ts
│   │   │   ├── driver_prediction_features.ts
│   │   │   ├── driver_sprint_features.ts  # 8-feature sprint scores
│   │   │   ├── fp2_long_run_times.ts      # FP2 per-driver long-run stint data
│   │   │   └── sprint_predictions.ts      # Sprint predicted winner
│   │   └── seed.ts                # DB seed helpers
│   └── modules/                   # Feature modules (service / controller / module)
│       ├── races/
│       │   ├── races.service.ts   # DB queries — race list, detail, circuit history
│       │   ├── circuit-era.helpers.ts     # Pure era bucketing for findCircuitDetails — Era/EraMap/ERAS, aggregateEraWins(), buildDominanceByEra(), normalizeTeamKey()
│       │   ├── circuit-stats.helpers.ts   # Pure per-response stat computations — buildCircuitHistory(), computeQualifyingImpactStats/WeatherStats/SafetyCarStats(), pickFastestLap(); owns WinnerRow/FastestLapRow
│       │   ├── circuit-headshot-backfill.ts # backfillDriverHeadshots() — the one DB-reading enrichment (swaps latest driver profiles into per-era win entries in place; no writes)
│       │   ├── races.controller.ts# Parses context, calls service, returns JSON
│       │   └── races.module.ts    # Hono sub-router: GET /, /circuits, /circuit/:key, /:id
│       ├── race-events/           # OpenF1-sourced race data, separate from races/ to keep its controller under budget
│       │   ├── race-events.service.ts    # getRaceControlMessages(), getOvertakes(), getTeamRadio(), raceExists()
│       │   ├── race-events.controller.ts # raceSubResource(getter) factory — one 404/cache/json shape, three getters bound to it
│       │   └── race-events.module.ts     # GET /:id/race-control, /:id/overtakes, /:id/team-radio (mounted at /api/races)
│       ├── drivers/
│       │   ├── drivers.service.ts # Driver list, standings, detail, career stats
│       │   ├── drivers.controller.ts
│       │   └── drivers.module.ts  # GET /, /standings, /:id, /:id/career
│       ├── teams/
│       │   ├── teams.service.ts   # Team list, standings, detail, career stats
│       │   ├── teams.controller.ts
│       │   └── teams.module.ts    # GET /, /standings, /:id, /:id/career
│       ├── predictions/
│       │   ├── predictions.service.ts # Upcoming (date-guarded), by race, history (incl. sprint), accuracy-by-season, standings, model-info
│       │   ├── predictions.helpers.ts # toFeatures() (GP feature row→DTO) + buildGpPredictionResponse() — the GP-specific query builders over common/prediction-response
│       │   ├── intel-standings.helpers.ts # aggregateSeasonFeatures() (table-driven per-feature averaging) + buildIntelStandingRows() (rank + min-max normalise + sprint totals) for findIntelStandings()
│       │   ├── predictions.controller.ts
│       │   └── predictions.module.ts  # GET /model-info, /upcoming, /race/:id, /history, /accuracy, /standings
│       ├── sprint/
│       │   ├── sprint.service.ts  # Sprint detail — results, SQ grid, lap summaries, prediction
│       │   ├── sprint.controller.ts
│       │   └── sprint.module.ts   # GET /upcoming, /race/:id
│       ├── seasons/
│       │   └── seasons.ts         # One file: GET / — season list. Too small for a service/controller/module split
│       ├── search/
│       │   └── search.ts          # One file: GET / — global search query (unique drivers, teams, circuits)
│       └── quality/
│           └── quality.ts         # One file: GET / — latest data-quality report (dev-only, no write path);
│                                   #   exports castSeverity() for its own test
├── drizzle/
│   └── migrations/                # Generated SQL migration files + Drizzle metadata
│       ├── 0000_glamorous_galactus.sql  # Initial schema
│       ├── 0001_useful_old_lace.sql     # Schema additions
│       └── meta/                        # Drizzle migration metadata (_journal.json, snapshots)
├── tests/
│   ├── unit/
│   │   ├── modules/
│   │   │   ├── quality/           # castSeverity() test (severity casting)
│   │   │   ├── races/             # circuit-era.helpers + circuit-stats.helpers tests (era win aggregation, per-response stat computations)
│   │   │   └── predictions/       # intel-standings.helpers test (feature averaging + standings normalise)
│   │   └── common/                # bun test — mirrors src/common/, one *.test.ts per file
│   │       ├── mappers.test.ts
│   │       ├── openf1-mappers.test.ts # toRaceControlMessage/toRaceOvertake/toTeamRadioClip
│   │       ├── standings.test.ts
│   │       ├── prediction-response.test.ts
│   │       ├── prediction-history.test.ts
│   │       ├── featureManifest.test.ts
│   │       ├── cache.test.ts
│   │       └── accuracy.test.ts
│   ├── integration/                # bun test — real Hono `app.request()` against a dedicated Neon test branch
│   │   ├── races/races.test.ts     # list/filter/detail/circuit-history joins
│   │   ├── race-events/race-events.test.ts # race-control message + overtakes + team-radio lists, ordering, 404
│   │   ├── drivers/drivers.test.ts # list/filter/standings/detail
│   │   ├── drivers/career.test.ts  # career + search link a person's seasons across name variants
│   │   ├── teams/teams.test.ts     # list/standings/detail
│   │   ├── seasons/seasons.test.ts # race-count aggregation
│   │   ├── search/search.test.ts   # cross-season dedup
│   │   ├── predictions/predictions.test.ts # upcoming/by-id/history/standings/accuracy/model-info
│   │   └── sprint/sprint.test.ts   # upcoming/by-id/detail, conventional-race guard
│   └── support/
│       ├── app/request.ts          # apiRequest() — in-process app.request() with TEST_DATABASE_URL env
│       ├── db/test-db.ts           # getTestDb()/truncateAll() — refuses to truncate if TEST_DATABASE_URL === DATABASE_URL
│       └── factories/              # one insert helper per table, FK chain: season → team/circuit → driver → race → results (+ prediction/sprint feature factories)
├── eslint.config.js               # Flat config — tiered `max-lines` (controller 80 / module 50 / service+helpers 200 / common 150 / default 150; schema+seed+types.ts+tests off), run via `bun run lint`
├── wrangler.toml                  # CF Workers config — keep_vars = true
├── drizzle.config.ts              # schema: src/db/schema, out: drizzle/migrations
├── tsconfig.json                  # CF Workers target — excludes Node-only files (drizzle.config, seed)
├── tsconfig.node.json             # Node target for drizzle.config.ts + seed.ts (@types/node)
├── .env.example                   # DATABASE_URL + TEST_DATABASE_URL
└── package.json
```

### Module Pattern

Each module follows the same three-file pattern:

| File | Responsibility |
|------|---------------|
| `*.service.ts` | Drizzle queries, no Hono context, returns typed data |
| `*.controller.ts` | Reads `c.req.query`/`c.req.param`, calls service, returns `c.json()` |
| `*.module.ts` | Creates Hono sub-router, wires routes to controller handlers |

### Routes

| Method | Path | Query params |
|--------|------|-------------|
| GET | `/api/health` | — |
| GET | `/api/seasons` | — |
| GET | `/api/races` | `year`, `status` |
| GET | `/api/races/circuits` | — |
| GET | `/api/races/circuit/:circuitKey` | — |
| GET | `/api/races/:id` | — |
| GET | `/api/races/:id/race-control` | — |
| GET | `/api/races/:id/overtakes` | — |
| GET | `/api/races/:id/team-radio` | — |
| GET | `/api/drivers` | `year`, `team_id` |
| GET | `/api/drivers/standings` | `year` |
| GET | `/api/drivers/:id` | `year` |
| GET | `/api/drivers/:id/career` | — |
| GET | `/api/teams` | `year` |
| GET | `/api/teams/standings` | `year` |
| GET | `/api/teams/:id` | `year` |
| GET | `/api/teams/:id/career` | — |
| GET | `/api/predictions/model-info` | — |
| GET | `/api/predictions/upcoming` | — |
| GET | `/api/predictions/race/:raceId` | — |
| GET | `/api/predictions/history` | `year` |
| GET | `/api/predictions/accuracy` | — |
| GET | `/api/predictions/standings` | `year` |
| GET | `/api/sprint/upcoming` | — |
| GET | `/api/sprint/race/:raceId` | — |

---

## Frontend (`apps/web/`)

Astro SSR with Cloudflare adapter. All data fetching is server-side in Astro frontmatter — no client-side data fetching.

```
apps/web/
├── src/
│   ├── content/
│   │   └── config.ts              # Astro Content Layer — docs collection via glob('../../docs')
│   ├── pages/                     # File-based routes
│   │   ├── index.astro            # Landing page (static)
│   │   ├── prediction.astro       # Upcoming prediction + history (GP + sprint merged) + calibration chart + Brier
│   │   ├── prediction/[id].astro  # Historical GP prediction — contribution breakdown, radar compare, what-if lab
│   │   ├── health-quality.astro   # Dev-only data-quality dashboard (404-guarded outside DEV)
│   │   ├── docs/
│   │   │   ├── index.astro        # Docs index — card grid of all docs
│   │   │   └── [slug].astro       # Individual doc page — all-docs sidebar, content, on-this-page rail
│   │   ├── circuits/
│   │   │   ├── index.astro        # Circuits directory index (filters/sorting)
│   │   │   └── [key].astro        # Circuit detail — history, dominance, weather
│   │   ├── races/
│   │   │   ├── index.astro        # Race calendar — sprint-aware cards
│   │   │   └── [id]/
│   │   │       ├── index.astro    # Race detail — results, qualifying, lap chart
│   │   │       └── sprint.astro   # Sprint detail — results, SQ grid, lap chart, conditions
│   │   ├── prediction/
│   │   │   ├── sprint/
│   │   │   │   └── [id].astro     # Sprint prediction detail — same feature set as GP, sprint model (8 weights)
│   │   │   └── recap/
│   │   │       ├── index.astro    # All-seasons recap landing — accuracy card per season
│   │   │       └── [year].astro   # Season recap — headline accuracy, best call, worst miss, streak, round strip
│   │   ├── drivers/
│   │   │   ├── index.astro        # Driver standings table
│   │   │   ├── compare.astro      # Driver head-to-head comparison tool
│   │   │   └── [id].astro         # Driver profile — stats, recent results
│   │   └── teams/
│   │       ├── index.astro        # Team standings table
│   │       ├── compare.astro      # Team head-to-head comparison tool
│   │       └── [id].astro         # Team profile — stats, driver roster
│   ├── layouts/
│   │   └── BaseLayout.astro       # Shared layout — Sidebar + MobileNav, slot, Footer, GlobalSearch; reads the sidebar cookie
│   ├── components/                # Generic, cross-feature only — domain UI lives in features/
│   │   ├── layout/
│   │   │   ├── Sidebar.astro      # Desktop collapsible sidebar — search, Season/Explore groups, docs, collapse toggle
│   │   │   ├── MobileNav.astro    # Mobile top bar + drawer with the same grouped list + focus-trap script
│   │   │   ├── NavGroups.astro    # The grouped destination list both Sidebar and MobileNav render
│   │   │   ├── SiteLogo.astro     # Brand mark SVG
│   │   │   ├── navLinks.ts        # buildNavGroups() + buildNavUtilities(isDev) + activeDestination() — nav model
│   │   │   └── Footer.astro       # Shared footer
│   │   ├── docs/
│   │   │   └── OnThisPage.astro   # Sticky right-rail TOC of a doc's h2 sections; scrollspy via IntersectionObserver
│   │   ├── shared/
│   │   │   ├── PageHeader.astro       # Kicker + h1 + subtitle; "aside" slot holds the season picker
│   │   │   ├── PageTabs.astro         # Server-rendered link tabs (?tab=, or a route href per tab)
│   │   │   ├── EmptyState.astro       # Bordered "nothing here yet" / error message
│   │   │   ├── YearSelect.astro       # Year selector; extraParams prop preserves filter/sort/tab on year change
│   │   │   ├── YearSelectLinks.astro  # Year selector using anchor links; used by driver/team profile pages
│   │   │   └── ConfidenceBadge.astro  # LOCK / LIKELY / TOSS-UP badge from the P1−P2 win-probability gap
│   │   └── ui/                    # Shadcn/ui primitives + generic widgets
│   │       ├── badge.tsx
│   │       ├── button.tsx
│   │       ├── card.tsx
│   │       ├── table.tsx
│   │       └── search-select.tsx  # Generic autocomplete combobox; shared by Driver/TeamCompareTool
│   ├── features/
│   │   ├── predictions/              # Shared prediction UI — GP + sprint pages compose these (accent prop)
│   │   │   ├── types.ts               # PredictionAccent, GP_ACCENT/SPRINT_ACCENT, PredictionPageKind, view-model interfaces
│   │   │   ├── buildPredictionPageData.ts  # buildPredictionPageData(kind, raceId) — the fetch/winner-pick/
│   │   │   │                          #   view-model assembly both prediction/[id].astro and prediction/sprint/[id].astro
│   │   │   │                          #   call; returns facts + a slim PREDICTION_BEHAVIOUR axis (fetchers, weights, meta, date field)
│   │   │   ├── predictionCopy.ts       # PREDICTION_COPY[kind] — all GP-vs-sprint wording (titles, kicker, labels, headings, blurbs); the views own it
│   │   │   └── components/
│   │   │       ├── PredictionPageBody.astro        # Full page body (header→banner→table→radar→WhatIfLab); both
│   │   │       │                                   #   [id].astro routes reduce to a fetch + <PredictionPageBody data={data} copy={copy} />
│   │   │       ├── PredictionHeader.astro          # Round kicker + title + ConfidenceBadge + circuit/model lines
│   │   │       ├── PredictionOutcomeBanner.astro   # Predicted → actual winner banner
│   │   │       ├── ContributionBar.astro           # "why {CODE}" — stacked bar of each feature's weighted-score share
│   │   │       ├── PredictionDriverTable.astro     # Full ranked driver table (accent via scoped <style define:vars>)
│   │   │       ├── DriverRadarCompare.astro        # 2-driver radar; bundled <script> reads a JSON payload node
│   │   │       ├── ModelWeightsGrid.astro          # Feature-weight grid (rendered xl + mobile per page)
│   │   │       ├── WhatIfLab.astro                 # Re-weight sliders; recompute weightedScore→softmax(0.3) in-browser
│   │   │       ├── CalibrationChart.astro          # Predicted vs actual win-rate scatter + perfect-calibration diagonal
│   │   │       └── UpcomingPredictionPanel.astro   # /prediction hero panel (GP + sprint share it)
│   │   ├── races/
│   │   │   ├── raceTabs.ts            # initRaceCountdown() + initRaceTabs() — shared by GP + sprint detail scripts
│   │   │   ├── raceEventDisplay.ts    # timeOf(), dotColor() — shared by the three Race Event list components
│   │   │   └── components/
│   │   │       ├── LapChart.astro         # Plain SVG lap time chart (no chart library)
│   │   │       ├── RaceControlTimeline.astro # Flags/SC/VSC/incident log, ordered by session time
│   │   │       ├── OvertakesList.astro    # On-track overtakes list; resolves driver codes via a driverMap prop built from race results
│   │   │       ├── TeamRadioList.astro    # Team radio clip list with a custom play/pause + progress-bar player (native <audio controls> didn't fit the dark UI)
│   │   │       ├── RaceResultsTable.tsx   # Race results with team color dots; flColor prop for sprint (orange)
│   │   │       ├── QualifyingGrid.tsx     # Qualifying session grid; labelPrefix prop ("Q" or "SQ")
│   │   │       ├── RaceYearSelect.astro   # Year selector for race/sprint detail; variant="orange"|"purple", extraParams prop
│   │   │       ├── RaceHeroInfo.astro     # Hero left column — status badge, meta, conditions strip, countdown (accent prop)
│   │   │       └── RacePredictionPanel.astro  # Hero right column — predicted winner + podium (accent prop)
│   │   ├── drivers/components/
│   │   │   ├── DriverStatsGrid.tsx    # Driver season stats card grid
│   │   │   ├── RecentResultsTable.tsx # Compact recent results table
│   │   │   ├── DriverCareerTable.astro # Per-season career rows (Career tab)
│   │   │   └── ModelTrackRecord.astro # Races the model tipped this driver to win (Model tab)
│   │   ├── teams/components/
│   │   │   └── TeamCareerTable.astro  # Per-season constructor rows (team History tab)
│   │   ├── standings/components/
│   │   │   ├── DriverStandingsTable.astro / TeamStandingsTable.astro  # Standings tabs on /drivers, /teams
│   │   │   └── TitleFight.astro / RacecraftTable.astro / ConstructorTitleOdds.astro
│   │   ├── hub/components/            # Home's three blocks
│   │   │   ├── HomeBlock.astro        # Shared block frame — ./kicker heading (region name) + footer links
│   │   │   ├── NextRaceBlock.astro    # Next race + countdown + model favourite
│   │   │   ├── LastRaceBlock.astro    # Last race Recap
│   │   │   └── ChampionshipBlock.astro # Top 3 drivers + top 3 teams
│   │   ├── history/components/
│   │   │   └── OnThisDayList.astro    # History → On this day tab
│   │   ├── circuits/
│   │   │   ├── components/
│   │   │   │   ├── CircuitsGrid.tsx      # React component for circuits grid (filters/sorting)
│   │   │   │   ├── WeatherForecast.tsx   # React weather forecast widget (Open-Meteo API)
│   │   │   │   ├── CircuitTelemetryCard.astro  # Longest straight, corner distribution, track bias bars
│   │   │   │   ├── CircuitWinnersTable.astro   # Recent-winners list for the circuit
│   │   │   │   └── DominanceCard.astro         # Era-filtered constructor/driver dominance + tab script
│   │   │   ├── circuitMetadata.ts     # Track coordinate and telemetry configuration
│   │   │   └── weather.ts             # Open-Meteo forecast fetch + ForecastDay type
│   │   ├── compare/
│   │   │   ├── components/
│   │   │   │   ├── DriverCompareTool.tsx  # Driver head-to-head comparison — entity-specific config over shared compare pieces
│   │   │   │   ├── TeamCompareTool.tsx    # Team head-to-head comparison — entity-specific config over shared compare pieces
│   │   │   │   ├── ComparisonRow.tsx      # Generic stat comparison bar; shared by Driver/TeamCompareTool
│   │   │   │   ├── CompareEntityCard.tsx  # Generic profile card (avatar/logo + name + subtitle); shared by Driver/TeamCompareTool
│   │   │   │   ├── CompareModeToggle.tsx  # Season/career mode switch
│   │   │   │   ├── CompareYearSelect.tsx  # Year selector variant for compare tools
│   │   │   │   └── CompareStatus.tsx      # Loading/error/empty-stats status display
│   │   │   ├── compareStats.ts        # aggregateCareerStats() + DEFAULT_COMPARE_YEAR — career stat aggregation
│   │   │   ├── driverCompareConfig.ts # seasonStatConfig + careerStatConfig — the driver stat rows
│   │   │   ├── compareReducer.ts      # Pure compareReducer(state, action, config) — hydrate/year/selection/mode
│   │   │   │                          #   transitions + stale-request guarding; no React import, tested directly
│   │   │   ├── useCompareController.ts # Thin useReducer wiring over compareReducer.ts — URL sync via injectable
│   │   │   │                          #   locationAdapter, discriminated season/career `comparison` result
│   │   │   └── compareTabs.ts         # COMPARE_TABS — Drivers/Teams route tabs shared by both compare pages
│   │   └── search/
│   │       ├── components/
│   │       │   └── GlobalSearch.tsx   # React global search palette (cmdk) — render only
│   │       └── useGlobalSearch.ts     # Search-open state hook (keyboard shortcut, sidebar/top-bar search button bridge, fetch-on-open, close animation)
│   ├── lib/                       # Only truly cross-feature helpers
│   │   ├── api.ts                 # Typed API client — all fetch calls, uses PUBLIC_API_URL
│   │   ├── teamColors.ts          # team_key → official hex color map (fallback #6B7280)
│   │   ├── teamLogos.ts           # team_key → /teams/<file> static logo path (null if no logo)
│   │   ├── countryFlags.ts        # country → emoji flag helper
│   │   ├── predictionMath.ts      # weightedScore, softmax (SOFTMAX_TEMPERATURE=0.3), radarFeatures(), contributions,
│   │   │                          #   confidenceTier, brierScore, calibrationBuckets, driverPredictionRecord,
│   │   │                          #   bestCall/worstMiss/longestStreak, GP_WEIGHTS/SPRINT_WEIGHTS + *_FEATURE_META
│   │   │                          #   (the canonical TS-side manifest, checked against docs/feature-weights.json)
│   │   ├── pageTabs.ts            # resolveTab() + tabHref() — ?tab= link tabs that keep other params
│   │   ├── sidebarState.ts        # Sidebar collapse cookie — isSidebarCollapsed() + sidebarCookie()
│   │   ├── legacyRedirects.ts     # legacyRedirect(path) — retired URLs → their new home
│   │   └── utils.ts               # cn() helper (clsx + tailwind-merge)
│   ├── middleware.ts              # 301s retired URLs via legacyRedirect()
│   ├── types/
│   │   └── index.ts               # All TypeScript types — Circuit, Team, Driver, Race,
│   │                              #   RaceResult, QualifyingResult, LapSummary,
│   │                              #   DriverSeasonStats, TeamSeasonStats, FeatureScores,
│   │                              #   DriverPrediction, PredictionResponse, RaceDetailResponse,
│   │                              #   DriverDetailResponse, TeamDetailResponse,
│   │                              #   DriverStanding, TeamStanding, PredictionHistoryItem (isSprint),
│   │                              #   IntelStandingRow, CircuitHistoryItem (hasSprint), SeasonSummary,
│   │                              #   SprintResult, SprintFeatureScores, DriverSprintPrediction,
│   │                              #   SprintPredictionResponse, SprintDetailResponse, ModelInfo,
│   │                              #   RaceControlMessage, RaceOvertake, TeamRadioClip
│   ├── styles/
│   │   └── globals.css            # Tailwind base + CSS custom properties
│   └── env.d.ts                   # Astro env type declarations
├── public/
│   ├── favicon.svg
│   └── teams/                     # Static team logo files (PNG/SVG/JPG) served at /teams/<teamKey>.*
├── tests/
│   ├── unit/
│   │   ├── compare/
│   │   │   └── compareStats.test.ts          # aggregateCareerStats() — pure, `node` env
│   │   ├── features/compare/
│   │   │   ├── compareReducer.test.ts        # pure, `node` env — hydrate/year/mode transitions, stale-request
│   │   │   │                                 #   guarding, explicit 6bf3415 hydration-race regression case
│   │   │   └── useCompareController.test.ts  # jsdom — URL hydration, career mode, location-adapter seam
│   │   ├── components/layout/
│   │   │   └── navLinks.test.ts              # pure — sidebar groups, utilities, active-destination matching
│   │   ├── lib/
│   │   │   ├── pageTabs.test.ts / sidebarState.test.ts / legacyRedirects.test.ts  # pure, `node` env
│   │   │   ├── teamColors.test.ts            # pure, `node` env
│   │   │   ├── teamLogos.test.ts             # pure, `node` env
│   │   │   ├── predictionMath.test.ts        # pure, `node` env — all predictionMath exports
│   │   │   └── utils.test.ts                 # pure, `node` env — unwrapSettled()
│   │   ├── features/races/
│   │   │   └── raceEventDisplay.test.ts      # pure, `node` env — timeOf(), dotColor()
│   │   └── features/search/                  # jsdom — hook + component tests, MSW-mocked API
│   │       ├── useGlobalSearch.test.ts
│   │       └── GlobalSearch.test.tsx
│   └── support/
│       ├── setup.ts                # jest-dom matchers, MSW server lifecycle, ResizeObserver stub for cmdk
│       └── msw/                    # fixtures.ts + handlers.ts — mocks src/lib/api.ts endpoints
├── vitest.config.ts                # jsdom is opt-in per file via `// @vitest-environment jsdom`; default env is `node`
├── eslint.config.js              # Flat config — tiered `max-lines` (pages 300 / components 250 / lib 200), run via `bun run lint`
├── wrangler.toml                  # CF Pages config — keep_vars = true, PUBLIC_API_URL
├── astro.config.mjs               # output: 'server', Cloudflare adapter
├── tailwind.config.mjs
├── tsconfig.json
└── package.json
```

### Pages

| Route | Data source | Notes |
|-------|-------------|-------|
| `/docs` | Astro Content Collections | Doc index — card grid of all 9 docs |
| `/docs/[slug]` | Astro Content Collections | Rendered markdown with sidebar nav + on-this-page rail |
| `/` | `races?year=` + `predictions/upcoming` + `races/:id/recap` + driver/team standings | Three blocks: next race, last race Recap, championship top 3 |
| `/prediction` | Upcoming: `predictions/upcoming` + `sprint/upcoming` + `predictions/standings` · Scorecard: `predictions/history?year=N` + `predictions/accuracy` | Tabs: Upcoming · Scorecard (hit rates, best call/worst miss/streak, race by race, calibration when ≥5 races, every season) |
| `/prediction/[id]` | `GET /api/predictions/race/:id` | Historical GP prediction — contribution breakdown, radar compare, in-browser what-if lab |
| `/prediction/sprint/[id]` | `GET /api/sprint/race/:id` | Sprint prediction detail — same feature set, sprint model |
| `/prediction/recap[/year]` | — | 301 → `/prediction?tab=scorecard[&year=N]` (`src/middleware.ts`) |
| `/races` | `GET /api/races?year=N` | Race calendar — filter (ALL/SPRINT/GP), sort (ASC/DESC), sprint weekends as two cards |
| `/races/[id]` | `GET /api/races/:id` | GP results, qualifying, lap chart |
| `/races/[id]/sprint` | `GET /api/sprint/race/:id` | Sprint results, SQ grid, sprint lap chart, conditions |
| `/circuits` | `GET /api/races/circuits` | Circuits directory list page |
| `/circuits/[key]` | `GET /api/races/circuit/:circuitKey` | Circuit detail — history, dominance, weather |
| `/drivers` | `GET /api/drivers/standings?year=N` | Standings table |
| `/drivers/compare` | `GET /api/drivers?year=N` + details | Driver head-to-head comparison page |
| `/drivers/[id]` | `GET /api/drivers/:id?year=N` | Profile + career |
| `/teams` | `GET /api/teams/standings?year=N` | Standings table |
| `/teams/compare` | `GET /api/teams?year=N` + details | Team head-to-head comparison page |
| `/teams/[id]` | `GET /api/teams/:id?year=N` | Profile + driver roster |

### Key Library Files

| File | Purpose |
|------|---------|
| `lib/api.ts` | Single typed API client. All pages call functions from here — never raw `fetch`. |
| `lib/teamColors.ts` | Maps `team_key` strings (e.g. `red_bull`, `ferrari`) to official hex colors. Used for colored badges/dots across standings, driver pages, and result tables. |
| `lib/teamLogos.ts` | Maps `team_key` to a static logo path under `/teams/`. Returns `null` for historical teams with no logo file. Used on teams index, teams detail, and drivers standings pages. |
| `lib/pageTabs.ts` | `resolveTab(url, tabs)` picks the open `?tab=` (first tab when absent/unknown); `tabHref()` builds a tab link that keeps `year` etc. and drops `tab` for the default. Pages fetch only the open tab's data. |
| `lib/sidebarState.ts` | Reads/writes the `sidebar` cookie — a cookie (not localStorage) so `BaseLayout` renders the right width server-side and the layout never jumps. |
| `lib/utils.ts` | `cn()` — combines `clsx` and `tailwind-merge` for conditional class names. `unwrapSettled(result, fallback)` — one-line `PromiseSettledResult` unwrap, used wherever a page fans out `Promise.allSettled()` calls. |
| `features/compare/compareReducer.ts` | Pure `compareReducer(state, action, config)` — every hydrate/year-change/selection/mode transition and stale-fetch-response guard, as one reducer with no React dependency; unit-tested directly. |
| `features/compare/useCompareController.ts` | Generic hook powering both compare tools — wraps `compareReducer` in `useReducer` plus the URL-hydrate, URL-sync, and fetch effects. Item list, A/B selection, discriminated `comparison` (season/career) result, URL sync through an injectable `locationAdapter` seam. |
| `features/search/useGlobalSearch.ts` | Hook powering `GlobalSearch` — open/close state, Cmd/Ctrl+K + Escape keyboard shortcut, `open-global-search` event bridge from the Sidebar/MobileNav search buttons, fetch-on-first-open, close-animation timing. |

---

## E2E (`apps/e2e/`)

Own package — see `docs/adr/0001-apps-layout-scoped-to-js-bun.md` for why this isn't nested under
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
│   ├── data.ts                    # Typed fixture objects (Driver, Race, PredictionResponse, ...)
│   └── server.ts                  # Bun.serve() — serves { data, error: null } + CORS headers for the routes under test
├── tests/
│   └── smoke/
│       ├── prediction.spec.ts      # /prediction renders against fixture data
│       ├── race-detail.spec.ts     # /races/1 renders against fixture data
│       ├── driver-detail.spec.ts   # /drivers/10 — stats grid + recent results
│       ├── team-detail.spec.ts     # /teams/1 — stats + driver roster
│       ├── global-search.spec.ts   # Cmd/Ctrl+K opens, shows results, Escape closes (client-side fetch)
│       ├── driver-compare.spec.ts  # /drivers/compare — URL-param-driven season comparison (client-side fetch)
│       ├── teams-compare.spec.ts   # /teams/compare — URL-param-driven constructor comparison (client-side fetch)
│       ├── sprint-prediction.spec.ts # /prediction/sprint/2 — sprint prediction detail page
│       └── race-sprint.spec.ts     # /races/2/sprint — sprint results + prediction panel + tabs
├── playwright.config.ts           # webServer: [fixture server, `astro dev` in ../web]
├── tsconfig.json
└── package.json
```

---

## Data Engine (`data-engine/`)

Python 3.11+ batch jobs. Fetches F1 data via FastF1, computes predictions, writes directly to Neon via psycopg2.

```
data-engine/
├── src/
│   ├── auto_runner.py             # Orchestrates ETL jobs via state machine; reverts status on failure.
│   │                              # Schedule-gated: skips the DB entirely outside a race-weekend window
│   ├── server.py                  # HTTP server: login-gated live dashboard + HEAD health check for UptimeRobot;
│   │                              # worker loop polls ~20 min in-window, ~6 h otherwise
│   ├── dashboard.py               # Renders the /login and status-dashboard HTML (styled to match apps/web)
│   ├── main.py                    # CLI entry point — --job, --year, --round, --race_id
│   │                              # Also auto-detects current race if year/round omitted
│   ├── config.py                  # FastF1 cache setup, environment loading
│   ├── db/
│   │   ├── client.py              # get_conn() — psycopg2 RealDictCursor connection
│   │   └── __init__.py
│   ├── jobs/
│   │   ├── sync_schedule.py            # Populate races table — includes sprint_date, event_format; renumber-safe (matches by event name)
│   │   ├── sync_season.py              # Populate teams + drivers from FastF1 session data
│   │   ├── ingest_qualifying.py        # Q1/Q2/Q3 + sector times — 2018+; date guard rejects future rounds
│   │   ├── ingest_qualifying_legacy.py # Qualifying from Ergast — pre-2018
│   │   ├── ingest_race.py              # Race results + lap times + conditions — 2018+
│   │   ├── ingest_race_control.py      # OpenF1 race-control messages → race_control_messages; _to_rows() over run_openf1_job (ingest_runner.py)
│   │   ├── ingest_overtakes.py         # OpenF1 overtakes → race_overtakes; _to_rows() resolves driver_number via the driver_map run_openf1_job passes in
│   │   ├── ingest_team_radio.py        # OpenF1 team radio → team_radio_clips; same driver_number resolution, empty/partial results are normal
│   │   ├── ingest_race_legacy.py       # Race results from Ergast (no laps) — pre-2018
│   │   ├── ingest_sprint_qualifying.py # SQ session → sq1/sq2/sq3 + sector times + speed; messages=True; date guard
│   │   ├── ingest_fp2.py               # Practice long-run stint data → fp2_long_run_times (FP2 primary; FP1 fallback on sprint weekends)
│   │   ├── ingest_sprint.py            # Sprint results + sprint_lap_times + sprint conditions
│   │   ├── compute_season_stats.py     # Aggregate driver/team stats including sprint aggregates
│   │   ├── compute_features.py         # 12 feature scores per driver per GP
│   │   ├── compute_predictions.py      # Softmax on GP feature scores → win probabilities
│   │   ├── compute_sprint_features.py  # 8 sprint feature scores per driver
│   │   ├── compute_sprint_predictions.py # Softmax on sprint scores → sprint win probabilities
│   │   ├── data_quality_audit.py        # Per-table completeness/coverage audit → data_quality_runs/issues
│   │   └── data_quality_repair.py       # Re-ingests data for fixable audit issues; recomputes features/predictions
│   └── utils/
│       ├── fastf1_helpers.py      # get_session(messages=False), session_to_race_results(),
│       │                          # session_to_quali_results(), session_to_lap_times(),
│       │                          # get_weather(), get_weather_details(), get_sc_vsc_laps()
│       ├── feature_manifest.py    # GP_FEATURES/SPRINT_FEATURES (name, weight, label, nullable) — the single source
│       │                          # for both models' weights; GP_WEIGHTS/SPRINT_WEIGHTS + assemble_scores() +
│       │                          # SOFTMAX_TEMPERATURE derive from it; checked against docs/feature-weights.json
│       ├── math_utils.py          # normalize_minmax(), softmax(), bayesian_win_rate(), clamp(), weighted_sum()
│       ├── upsert.py              # upsert(conn, table, rows, conflict_cols, exclude_update=[])
│       ├── driver_map.py          # build_driver_code_map(), build_driver_number_map(conn, season_id) — shared driver code/number→id lookups for ingest jobs
│       ├── driver_registry.py     # session_entries(), register_session_drivers() — adds a session's missing drivers/teams before results are mapped
│       ├── f1db_results.py        # match_f1db_driver(), race_row(), qualifying_row() — F1DB record → our rows
│       ├── f1db_backfill.py       # plan_season() — pure diff of one season vs F1DB (codes, new drivers, merges, rows)
│       ├── openf1_client.py       # get_session_key(), fetch_race_control(), fetch_overtakes(), fetch_team_radio() over one shared _get(path, params) — thin OpenF1 REST client (free/historical tier only)
│       ├── prediction_runner.py   # run_prediction_job(...) — shared softmax/rank/upsert logic for GP + sprint predictions
│       ├── ingest_runner.py       # Three seams: run_ingest_job(...) — shared headshot/results/lap-time/status logic for
│       │                          # ingest_race + ingest_sprint; run_qualifying_ingest_job(...) — shared logic for
│       │                          # ingest_qualifying + ingest_sprint_qualifying (no weather/laps/headshots);
│       │                          # run_openf1_job(...) — shared resolve/guard/upsert logic for the OpenF1-sourced jobs
│       │                          # (ingest_race_control/ingest_overtakes/ingest_team_radio); each supplies only a
│       │                          # table, conflict_cols, a fetch(session_key) callable, and a to_rows() shaping callable
│       ├── feature_helpers.py     # Shared scoring math for GP + sprint models — compute_weather_score(),
│       │                          # compute_luck_score(), circuit_adj_start_pos(), compute_rolling_teammate_delta()
│       ├── feature_context.py     # build_feature_context() — shared query/assembly scaffolding (race+circuit row,
│       │                          # grid map, start_pos, driver/team season stats) behind both feature jobs
│       ├── quality_utils.py       # health_from_issues() + ISSUE_REPAIR_STEPS manifest (is_fixable()/resolve_issue_actions()
│       │                          #   both derive from it — single source of truth for what's fixable and how)
│       └── schedule_window.py     # race_weekend_window() — pure race-weekend window from the FastF1 calendar, no DB
├── scripts/                       # One-off/operational scripts — not imported by src/
│   ├── run_backfill.py            # Full historical backfill runner — sync + ingest + compute, per year range
│   ├── backfill_full.py           # Full historical backfill: sync + ingest + sprint + predictions
│   ├── backfill_sprint.py         # Sprint-only backfill for specific years
│   ├── backfill_fp2.py            # Backfill FP2 long-run data for 2018+ completed races
│   ├── backfill_openf1.py         # Backfill any OpenF1 job (race control, overtakes, radio, stints, pit stops) for a year range — 2023+, local only, stops at the storage guard
│   ├── backfill_all_predictions.py # Recompute GP + sprint predictions for all races (weighted-v3 / sprint-v2)
│   ├── backfill_historical.sh     # Shell loop over sync_schedule/ingest/compute for a year range
│   ├── f1db_release.py            # Download + SHA-256-verify + extract an F1DB release (shared by the scripts below)
│   ├── import_f1db.py             # Import F1DB all-time history tables
│   ├── audit_results_vs_f1db.py   # Read-only: every race's results vs F1DB; --modern-plan lists 2018+ races to re-ingest
│   ├── backfill_results_from_f1db.py # Rebuild 1980–2017 results/drivers from F1DB (ADR 0009) — dry run unless --apply
│   └── populate_all.sh            # One-time population run for 2021–2025
├── tests/                          # pytest — pure functions directly; DB-touching functions via a fake-db double
│   ├── conftest.py                 # Placeholder DATABASE_URL so importing job modules doesn't need a real .env
│   ├── support/
│   │   └── fake_db.py              # FakeCursor/FakeConnection — scripted RealDictCursor-shaped rows, no real DB
│   ├── test_math_utils.py          # normalize_minmax, softmax, bayesian_win_rate, clamp, weighted_sum
│   ├── test_quality_utils.py       # health_from_issues + is_fixable/resolve_issue_actions (both derive from ISSUE_REPAIR_STEPS)
│   ├── test_feature_helpers_pure.py # car_rank, circuit_adj_start_pos
│   ├── test_feature_helpers_db.py  # compute_weather_score, compute_luck_score — via fake_db
│   ├── test_feature_context.py     # build_feature_context, build_driver_code_map, build_driver_number_map — via fake_db
│   ├── test_fastf1_helpers.py      # ms_to_int (the one pure function in fastf1_helpers.py)
│   ├── test_weights.py             # WEIGHTS sum-to-1 + positivity, assemble_scores() key-drift guard,
│   │                                #   both models checked against docs/feature-weights.json
│   ├── test_prediction_ranking.py  # rank_by_probability
│   ├── test_prediction_runner.py   # run_prediction_job — via fake_db + monkeypatched execute_batch
│   ├── test_upsert.py              # upsert() param shape + no-op-on-empty — via fake_db + monkeypatched execute_batch
│   ├── test_schedule_window.py     # race_weekend_window + RaceWeekendWindow.contains
│   ├── test_auto_runner.py         # run_cycle() schedule gate, decide_next_action, revert-on-failure, poll_interval_for_window
│   ├── test_ingest_runner.py       # run_ingest_job + run_qualifying_ingest_job + run_openf1_job (guards, driver_map pass-through) — via fake_db + monkeypatched fastf1_helpers
│   ├── test_ingest_race_control.py # _to_rows() pure-function shaping + run() config-wiring check
│   ├── test_ingest_overtakes.py    # _to_rows() pure-function shaping incl. unknown-driver-number skipping + run() config-wiring check
│   ├── test_ingest_team_radio.py   # _to_rows() pure-function shaping incl. unknown-driver-number skipping + run() config-wiring check
│   ├── test_openf1_client.py       # get_session_key (date match incl. 1-day drift, pre-2023 no-coverage), fetch_race_control, fetch_overtakes, fetch_team_radio
│   ├── test_data_quality_audit.py  # _audit_race gate/threshold branching per race status — via fake_db
│   ├── test_data_quality_repair.py # run() audit-run selection, per-race issue grouping + step dedup, resolve/rollback — mocked jobs
│   ├── test_main_auto_detect.py    # auto_detect_race/sprint_qualifying/sprint — row→(year,round), exit(1), query filters
│   ├── test_sync_schedule.py       # _to_utc_iso + run() circuit-key resolution (Madrid/Spielberg year overrides), status-preserving upsert, round renumbering
│   ├── test_sync_season.py         # run() hands the round's drivers to the registry, refreshing known ones
│   ├── test_driver_registry.py     # session entries (code fallbacks incl. NaN, team keys) + registering missing drivers/teams
│   ├── test_f1db_results.py        # F1DB driver matching (accents, surname, aliases) + race/qualifying row building
│   ├── test_f1db_backfill.py       # plan_season — stand-ins sharing a number, NAN codes, merges, wrong-driver deletes
│   └── test_compute_sprint_features.py # _compute_short_run_pace SQ-time source, main-quali fallback, min-max inversion
├── render.yaml                    # Render cron job definitions
├── requirements.txt               # Python dependencies
├── requirements-dev.txt           # requirements.txt + pytest
├── pyproject.toml                 # pytest config (pythonpath, testpaths)
└── .env.example                   # DATABASE_URL template
```

### Jobs

| Job | Input | Purpose |
|-----|-------|---------|
| `sync_schedule` | `--year` | Populates `races` table with sprint dates and event_format |
| `sync_season` | `--year [--round]` | Populates `teams` and `drivers` from one round; ingests register later arrivals themselves |
| `ingest_qualifying` | `--year --round` | Q1/Q2/Q3 times, sector times, grid positions — 2018+ |
| `ingest_qualifying_legacy` | `--year --round` | Grid positions and Q times via Ergast — pre-2018 |
| `ingest_race` | `--year --round` | Race results + per-lap timing + conditions — 2018+ |
| `ingest_race_legacy` | `--year --round` | Race results only via Ergast — pre-2018 |
| `ingest_sprint_qualifying` | `--year --round` | SQ session → sprint_results (sq1/sq2/sq3 + sector times + speed); date guard rejects future rounds |
| `ingest_fp2` | `--year --round` | Practice long-run stints → `fp2_long_run_times` (FP2 primary, FP1 fallback on sprint weekends); used as primary long-run pace signal |
| `ingest_sprint` | `--year --round` | Sprint results + sprint_lap_times + sprint conditions; sprint weekends only |
| `ingest_race_control` | `--year --round` | OpenF1 flags/SC/VSC/incident messages — completed races only, 2023+ (no OpenF1 coverage before), gated past OpenF1's live window |
| `ingest_overtakes` | `--year --round` | OpenF1 on-track overtakes — same 2023+/completed/live-window gating; skips rows whose driver number can't be resolved |
| `ingest_team_radio` | `--year --round` | OpenF1 team radio clips — same 2023+/completed/live-window gating; F1 doesn't release radio for every session, so a partial or empty result is normal |
| `compute_season_stats` | `--year` | Rolling aggregates for drivers and teams, including sprint stats |
| `compute_features` | `--race_id` | 12 feature scores per driver for a GP |
| `compute_predictions` | `--race_id` | Softmax → GP win probabilities and predicted positions |
| `compute_sprint_features` | `--race_id` | 8 sprint feature scores per driver |
| `compute_sprint_predictions` | `--race_id` | Softmax → sprint win probabilities and predicted positions |

### Utilities

| File | Key functions |
|------|--------------|
| `fastf1_helpers.py` | `get_session(year, round, type, messages=False)` — loads FastF1 session (SQ sessions need `messages=True`); `session_to_quali_results()`, `session_to_race_results()`, `session_to_lap_times()` — extract structured dicts from FastF1 DataFrames |
| `feature_manifest.py` | `GP_FEATURES`/`SPRINT_FEATURES: tuple[FeatureSpec, ...]` (name, weight, label, nullable) — the single source for both models' weights; `GP_WEIGHTS`/`SPRINT_WEIGHTS` dicts and `SOFTMAX_TEMPERATURE` derive from it; `assemble_scores(values, features)` raises `KeyError` if a manifest feature's score was never computed. Checked against `docs/feature-weights.json` (also read by `apps/web`'s `predictionMath.test.ts`) so Python and TS weights can't silently drift |
| `math_utils.py` | `normalize_minmax(values)` — min-max to [0,1]; `softmax(scores, temperature=SOFTMAX_TEMPERATURE)` — temperature-scaled; `bayesian_win_rate(wins, races)` — Laplace smoothed; `clamp(value)`; `weighted_sum(scores, weights)` — dot product of a feature-score dict against a model's `WEIGHTS` dict, shared by `compute_features`/`compute_sprint_features` |
| `upsert.py` | `upsert(conn, table, rows, conflict_cols, exclude_update=[])` — idempotent bulk write; `exclude_update` prevents overwriting specified columns (used to protect sprint race data from SQ re-ingest) |
| `feature_helpers.py` | Shared scoring math for GP + sprint models: `compute_weather_score()`, `compute_luck_score()`, `circuit_adj_start_pos()`, `compute_rolling_teammate_delta()` |
| `feature_context.py` | `build_feature_context(conn, race_id, grid_table=..., grid_not_found_message=..., validate_race=None)` — shared query/assembly scaffolding for `compute_features` and `compute_sprint_features`: race+circuit row, grid map, per-driver starting position, driver season stats, team perf/reliability |
| `prediction_runner.py` | `run_prediction_job(...)` — shared softmax/rank/upsert logic for GP + sprint predictions; `rank_by_probability(driver_ids, probabilities)` — pure position-ranking + winner-pick, extracted so it's unit-testable without a DB connection |
| `ingest_runner.py` | Three seams, matched to three different session shapes (see the module docstring for why they're not one). `run_ingest_job(year, round, IngestJobConfig)` — full race/sprint session (weather, SC/VSC, results, lap times, headshots); `IngestJobConfig.mark_status` writes the job's own `races` row, an optional `cross_table_hook` runs after it for effects on other tables (e.g. `ingest_race`'s `circuits.sc_probability` recompute). `run_qualifying_ingest_job(year, round, QualifyingJobConfig)` — qualifying-only session (just quali times, no weather/laps/headshots); `QualifyingJobConfig.rows_from_quali` is the per-job typed `session → rows` function used by `ingest_qualifying`/`ingest_sprint_qualifying`. `run_openf1_job(year, round, OpenF1JobConfig)` — the shared resolve-race/completed-guard/live-window-guard/upsert/commit shape behind the three OpenF1-sourced jobs; `OpenF1JobConfig.fetch(session_key)` calls the right `openf1_client` function, `to_rows(raw, race_id, driver_map)` shapes rows and returns `(rows, skipped_count)` — `driver_map` (built once via `build_driver_number_map`) is always passed even to configs that ignore it |
| `schedule_window.py` | `race_weekend_window(schedule, now)` → `RaceWeekendWindow \| None` — the current/next GP's window (FP1−1h … race+24h) derived purely from the FastF1 calendar, no DB; `RaceWeekendWindow.contains(now)`. Used by `auto_runner` to gate all DB access and to size the worker's poll interval |

---

## Docs (`docs/`)

| File | Content |
|------|---------|
| `architecture.md` | Monorepo layout, ASCII system diagram, data flow through a race weekend |
| `data-pipeline.md` | Job descriptions, required chain order, cron schedule, local commands, backfill, idempotency |
| `database-schema.md` | Every table with all columns, types, and notes; ER-style relationship diagram |
| `prediction-model.md` | All 12 features with weights, weighted score formula, softmax, data availability by era |
| `rulebased-architecture.md` | Per-feature inventory of the weighted-v3 predictor: source, computation, weight, usage |
| `api-reference.md` | All endpoints with query params, response shapes, error codes |
| `frontend.md` | Astro SSR app — stack, server-only data-fetch rule + 3 exceptions, `components/` vs `features/`, routes, styling, file-size budget |
| `deployment.md` | Env vars for all three platforms, CORS config, first-time setup, local dev |
| `testing.md` | The five suites (pytest, api unit/integration, web vitest, e2e Playwright) — what each covers, how to run, CI jobs |

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
