# Data Engine: Python ETL on Render

Batch ETL jobs that ingest F1 data from OpenF1 and Jolpica and compute race predictions. Runs on Render as one worker; writes directly to Neon PostgreSQL via psycopg2.

FastF1 is no longer a live source: since 3.9 its timing data needs a paid F1TV subscription and
older versions load none (ADR 0011). It's kept for the event calendar, the pre-2018 `_legacy`
jobs (results from Ergast, still free) and the 2018–2022 backfills, which only work from an
existing FastF1 cache.

## Setup

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in DATABASE_URL
```

## Running Jobs

```bash
# Sync race schedule and driver/team roster
python -m src.main --job sync_schedule --year 2026
python -m src.main --job sync_season   --year 2026 --round 1

# Main qualifying + race pipeline
python -m src.main --job ingest_qualifying --year 2026 --round 6
python -m src.main --job ingest_race       --year 2026 --round 6
python -m src.main --job compute_season_stats --year 2026
python -m src.main --job compute_features    --race_id 42

# Sprint pipeline (sprint weekends only)
python -m src.main --job ingest_sprint_qualifying --year 2026 --round 9
python -m src.main --job compute_sprint_features  --race_id 55
python -m src.main --job compute_sprint_predictions --race_id 55
python -m src.main --job ingest_sprint            --year 2026 --round 9

# Pre-2018 legacy jobs (Ergast: no lap data)
python -m src.main --job ingest_qualifying_legacy --year 2010 --round 5
python -m src.main --job ingest_race_legacy       --year 2010 --round 5
```

## Historical Backfill

```bash
# Full backfill: sync + all rounds + sprint pipeline + predictions
python scripts/backfill_full.py --start 2023           # OpenF1 covers 2023+; 2018–2022 rounds now skip
python scripts/backfill_full.py --start 2000           # 2000–2026, older years skip gracefully

# Sprint-only backfill: re-run sprint pipeline for specific years
python scripts/backfill_sprint.py --years 2021 2022 2024 2026
```

Data coverage:
- **2018–present**: full timing (qualifying, lap times, sprint lap times, conditions): OpenF1 for live ingest, FastF1 data already stored for older seasons
- **2000–2017**: Ergast results only (no lap times; no sprint, format started 2021)

## Cron Schedule (Render)

### Conventional Weekend

| Time (UTC) | Jobs |
|------------|------|
| Saturday 22:00 | `ingest_qualifying` → `compute_features` |
| Sunday 18:00 | `ingest_race` → `compute_season_stats` |

### Sprint Weekend

| Time (UTC) | Jobs |
|------------|------|
| Friday 22:00 | `ingest_sprint_qualifying` → `compute_sprint_features` → `compute_sprint_predictions` |
| Saturday 16:00 | `ingest_sprint` → `compute_season_stats` |
| Saturday 22:00 | `ingest_qualifying` → `compute_features` |
| Sunday 18:00 | `ingest_race` → `compute_season_stats` |

## FastF1 Cache

The 2018–2022 backfills only work from sessions already in this cache, since new timing downloads need F1TV:

```python
import fastf1
fastf1.Cache.enable_cache('./cache')
```

The `cache/` directory is gitignored. Already enabled via `src/config.py`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Neon PostgreSQL connection string (psycopg2 TCP) |

## Rules

- All jobs are idempotent: safe to re-run (`INSERT ... ON CONFLICT DO UPDATE`)
- Sprint qualifying ingest never overwrites existing sprint race finish positions (`exclude_update` guard)
- Jobs exit with code 1 on failure (Render marks the job failed for manual retrigger)
- No `sleep()` inside jobs: Render has a job timeout
- Structured logging: `{"job": "ingest_race", "round": 14, "status": "failed", "error": "..."}`
- Never write through the Hono API: connect directly to Neon
