# [F1 Prediction Platform](https://f1.gorkemkaryol.dev/)

![F1 Prediction Platform](./preview/Preview-landingPage.png)

F1 race winner prediction using historical and current data via FastF1. A weighted 12-feature scoring model with softmax outputs win probabilities for all drivers before each race. Features a detailed Circuits directory mapping track footprints, overtake rates, and safety car likelihood, along with Driver and Team head-to-head performance comparison tools. Historical data covers 1980–2026.

## Stack

| Layer | Technology | Host |
|-------|-----------|------|
| Frontend | Astro SSR + Tailwind | Cloudflare Pages |
| API | Hono + Drizzle ORM | Cloudflare Workers |
| Database | Neon PostgreSQL | Neon |
| Data Engine | Python + FastF1 | Render |

## Monorepo Layout

```
f1-prediction/
├── apps/
│   ├── web/       # Astro SSR (output: 'server', Cloudflare adapter)
│   └── api/       # Hono on Cloudflare Workers (NestJS-style modules)
│       ├── drizzle/migrations/  # Generated SQL migrations
│       └── src/
│           ├── db/schema/   # Drizzle table definitions (source of truth)
│           └── modules/     # races, drivers, teams, predictions, seasons
├── data-engine/   # Python ETL polling web service on Render
│   └── src/jobs/  # sync, ingest, compute jobs
└── docs/          # Architecture, API reference, schema, pipeline, deployment
```

See [CODEMAP.md](./CODEMAP.md) for the full file-level reference and [docs/adr/](./docs/adr/) for architectural rationale.

## Local Development

### Root (apps/api + apps/web)
```bash
bun run install:all
bun run dev         # runs api + web dev servers concurrently
```

### API (Hono — Cloudflare Workers)
```bash
cd apps/api
bun install
bun run dev        # wrangler dev on :8787
```

### Frontend (Astro)
```bash
cd apps/web
bun install
bun run dev        # Astro dev server on :4321
```

### Data Engine (Python)
```bash
cd data-engine
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in DATABASE_URL
```

### Database (Drizzle)
```bash
cd apps/api
bunx drizzle-kit push   # apply schema to Neon
```

## ETL Jobs

```bash
cd data-engine
# First-time setup for a season
python -m src.main --job sync_schedule --year 2025
python -m src.main --job sync_season   --year 2025 --round 1

# Weekly pipeline
python -m src.main --job ingest_qualifying   --year 2025 --round 14
python -m src.main --job compute_features    --race_id 42
python -m src.main --job compute_predictions --race_id 42
python -m src.main --job ingest_race         --year 2025 --round 14
python -m src.main --job compute_season_stats --year 2025
```

Historical backfill (2018+ FastF1, pre-2018 Ergast):
```bash
cd data-engine
python scripts/run_backfill.py 2000 2025
```

## Environment Variables

| Variable | Service | How to set |
|----------|---------|-----------|
| `DATABASE_URL` | API (Worker) | Cloudflare Workers dashboard → Variables and Secrets → **Secret** |
| `DATABASE_URL` | Data Engine | Render dashboard → Environment Variables |
| `PUBLIC_API_URL` | Frontend | Cloudflare Pages dashboard → Environment Variables |

## Prediction Model

12 features, softmax with temperature T=0.3:

| Feature | Weight |
|---------|--------|
| Car Performance | 20% |
| Long Run Pace | 15% |
| Tyre Degradation | 8% |
| Reliability | 8% |
| Qualifying Delta | 8% |
| Driver Rating | 8% |
| Win Rate | 8% |
| Luck Factor | 7% |
| Circuit-Adj. Starting Position | 7% |
| Sector Strength | 6% |
| Circuit-Adj. Position Gain | 3% |
| Weather Impact | 2% |

See [docs/prediction-model.md](./docs/prediction-model.md) for full details.

## Deployment

- **API**: push to GitHub → Cloudflare Workers auto-deploys
- **Frontend**: push to GitHub → Cloudflare Pages auto-deploys
- **Data Engine**: Render Web Service (Hourly Polling)
