---
title: "Architecture"
description: "Monorepo layout, four-layer service topology, and how the pieces connect"
order: 1
---

# Architecture

## Monorepo Layout

```
F1-prediction/
├── apps/
│   ├── web/       Astro SSR frontend: Cloudflare Pages
│   └── api/       Hono REST API: Cloudflare Workers
└── data-engine/   Python ETL batch jobs: Render
```

The schema source of truth lives in `apps/api/src/db/schema/`. Generated SQL migration files live in
`apps/api/drizzle/migrations/`: both are owned by `apps/api/`, not a separate top-level package.

---

## How the Four Layers Connect

```
┌─────────────────────────────────────────────────┐
│  Browser                                        │
└────────────────────┬────────────────────────────┘
                     │ HTTPS
┌────────────────────▼────────────────────────────┐
│  apps/web/  (Astro SSR: Cloudflare Pages)      │
│  Renders HTML server-side, fetches from API     │
│  in Astro frontmatter (never client-side JS)    │
└────────────────────┬────────────────────────────┘
                     │ HTTP (PUBLIC_API_URL)
┌────────────────────▼────────────────────────────┐
│  apps/api/  (Hono: Cloudflare Workers)         │
│  Read-only REST API, Drizzle ORM queries        │
│  Uses @neondatabase/serverless (HTTP driver)    │
└────────────────────┬────────────────────────────┘
                     │ Neon HTTP
┌────────────────────▼────────────────────────────┐
│  Neon PostgreSQL                                │
│  Shared DB: written by data-engine,            │
│  read by api                                    │
└────────────────────▲────────────────────────────┘
                     │ psycopg2 TCP
┌────────────────────┴────────────────────────────┐
│  data-engine/  (Python: Render Web Service)    │
│  Fetches F1 data via FastF1, computes           │
│  features and predictions, writes to DB         │
└─────────────────────────────────────────────────┘
```

---

## Key Constraints

**Cloudflare Workers have no TCP.** The `apps/api/` layer must use `@neondatabase/serverless` (HTTP driver). Never use `pg` or `postgres` packages there.

**Python writes directly to Neon.** The API is read-only. There are no write endpoints: the ETL engine connects directly via psycopg2.

**All data fetching in Astro frontmatter.** No client-side data fetching, no React/Vue islands for data. The `---` blocks handle everything server-side.

---

## Data Flow: Conventional Weekend

```
Saturday
  data-engine: ingest_qualifying   → qualifying_results table
  data-engine: ingest_fp2          → fp2_long_run_times table
  data-engine: compute_features    → driver_prediction_features table
  data-engine: compute_predictions → race_predictions table
  race.status: scheduled → qualifying_done

Sunday
  data-engine: ingest_race         → race_results + lap_times tables
  data-engine: compute_season_stats→ driver_season_stats + team_season_stats
  race.status: qualifying_done → completed
```

## Data Flow: Sprint Weekend

```
Friday
  data-engine: ingest_sprint_qualifying → sprint_results (SQ grid + sq1/sq2/sq3 times)
  data-engine: compute_sprint_features  → driver_sprint_features
  data-engine: compute_sprint_predictions → sprint_predictions
  race.status: scheduled → sprint_qualifying_done

Saturday
  data-engine: ingest_sprint        → sprint_results (finish positions), sprint_lap_times,
                                      races (sprint_weather, sprint_safety_car_laps, etc.)
  data-engine: compute_season_stats → updates sprint aggregates in driver_season_stats
  race.status: sprint_qualifying_done → sprint_done

  data-engine: ingest_qualifying    → qualifying_results
  data-engine: ingest_fp2           → fp2_long_run_times
  data-engine: compute_features     → driver_prediction_features
  data-engine: compute_predictions  → race_predictions
  race.status: sprint_done → qualifying_done

Sunday
  data-engine: ingest_race          → race_results + lap_times
  data-engine: compute_season_stats → final season stats
  race.status: qualifying_done → completed
```

---

## Screenshots

**Home**

![Home page](../preview/Preview-homePage.webp)

**Races calendar**

![Races page](../preview/Preview-racesPage.webp)

**Race detail**

![Race detail page](../preview/Preview-races[id]Page.webp)

**Race story: gap to leader and positions, lap by lap**

![Race story page](../preview/Preview-raceStoryPage.webp)

**Qualifying telemetry: two fastest laps compared**

![Telemetry page](../preview/Preview-telemetryPage.webp)

**Driver standings**

![Drivers page](../preview/Preview-driversPage.webp)

**Driver detail**

![Driver detail page](../preview/Preview-drivers[id]Page.webp)

**Constructors: pit crew rankings**

![Teams page](../preview/Preview-teamsPage.webp)

**Constructor detail**

![Team detail page](../preview/Preview-teams[id]Page.webp)

**Circuits directory**

![Circuits page](../preview/Preview-circuitsPage.webp)

**Circuit detail**

![Circuit detail page](../preview/Preview-circuit[id]Page.webp)

**Driver comparison tool**

![Driver comparison page](../preview/Preview-driverComparisonPage.webp)

**Team comparison tool**

![Team comparison page](../preview/Preview-teamComparisonPage.webp)

**All-time history (F1DB)**

![History page](../preview/Preview-historyPage.webp)

---

## Deployment

| Layer | Host | Trigger |
|-------|------|---------|
| `apps/web/` | Cloudflare Pages | Push to `master` → GitHub integration auto-deploys |
| `apps/api/` | Cloudflare Workers | Push to `master` → GitHub integration auto-deploys |
| `data-engine/` | Render | Web Service (hourly polling) |
| DB migrations | Neon | Manual: `bun run db:push` from `apps/api/` |
