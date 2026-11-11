# Data Engine: Python ETL on Render

Batch ETL jobs for the F1 Intelligence Platform: they ingest F1 data from OpenF1 and Jolpica and compute
race predictions. Runs on Render as one web service (`python -m src.server`, see `render.yaml`) that loops
the worker; writes directly to Neon PostgreSQL via psycopg2. Python 3.12 (`.python-version`; newer
Pythons have no numpy/pandas wheels and the source build OOMs Render's free tier).

FastF1 is no longer a live source: since 3.9 its timing data needs a paid F1TV subscription and
older versions load none (ADR 0011). It's pinned at 3.5.3 and kept for the event calendar, the pre-2018 `_legacy`
jobs (results from Ergast, still free) and the 2018–2022 backfills, which only work from an
existing FastF1 cache.

## Setup

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt   # requirements-dev.txt adds pytest
cp .env.example .env
```

`.env.example` points `DATABASE_URL` at the local dev Postgres (`postgresql://f1:f1@localhost:5435/f1_dev`),
never Neon. Fill it once with `PROD_DATABASE_URL=... python scripts/dev_snapshot.py`: it starts
`../docker-compose.dev.yml` and restores one read-only Neon dump. Writing production is
explicit: `DATABASE_URL=$PROD_DATABASE_URL python ...`.

Tests: `pytest` (no DB: DB-touching code runs against `tests/support/fake_db.py`).

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
python -m src.main --job compute_title_odds  --year 2026

# Sprint pipeline (sprint weekends only)
python -m src.main --job ingest_sprint_qualifying --year 2026 --round 9
python -m src.main --job compute_sprint_features  --race_id 55
python -m src.main --job ingest_sprint            --year 2026 --round 9

# Race Events / race story / telemetry: --session Race (default) or Sprint
python -m src.main --job ingest_race_story --year 2026 --round 9 --session Sprint

# Data quality
python -m src.main --job data_quality_audit  --year 2026   # or --all
python -m src.main --job data_quality_repair --year 2026
```

Every job is one entry in `src/jobs/registry.py` (the CLI's `--job` choices). Round-scoped jobs run
without `--year/--round` on the latest round whose Race Status says they're due. The pre-2018 `_legacy`
jobs (Ergast: no lap data) aren't CLI jobs: `scripts/backfill_full.py` runs them.

## Historical Backfill

```bash
# Full backfill: sync + all rounds + sprint pipeline + predictions
python scripts/backfill_full.py --start 2023           # OpenF1 covers 2023+
python scripts/backfill_full.py --start 2000           # 2000–2017 legacy results, 2018–2022 skipped (ADR 0011), 2023+ live

# Sprint-only backfill: re-run sprint pipeline for specific years (OpenF1: 2023+)
python scripts/backfill_sprint.py --years 2023 2024 2026

# Enrichment: OpenF1 (2023+) and FastF1 cache (2018–2022)
python scripts/backfill_openf1.py ingest_stints 2023 2026 [--session Sprint] [--refresh]
python scripts/backfill_fastf1_enrichment.py 2018 2022 [--only stints,pits,race_control,telemetry] [--refresh]
python scripts/backfill_race_story.py 2018 2022
python scripts/backfill_fp2.py

# Predictions and title odds
python scripts/backfill_all_predictions.py [--from 2018]   # GP fitted per season, out-of-sample
python scripts/backfill_title_odds.py 2018 2026

# History (F1DB, CC-BY-4.0)
python scripts/import_f1db.py [--version vYYYY.RR.M]
python scripts/audit_results_vs_f1db.py [--modern-plan]
python scripts/backfill_results_from_f1db.py --from 1980 --to 2017 [--apply]

# GP model (local backtest snapshot, never Neon)
python scripts/backtest_snapshot.py
python scripts/backtest.py [--from 2018] [--to 2026] [--reference NAME] [--json]
python scripts/fit_model_v4.py                              # only after backtest.py validates the change

# Neon Free usage (control-plane API: never wakes the DB)
python scripts/neon_usage.py
```

Backfills run locally in bounded chunks, check `storage_guard` first, and never run on Render.
Full detail: `docs/data-pipeline.md`.

Data coverage:
- **2018–present**: full timing (qualifying, lap times, sprint lap times, conditions): OpenF1 for live ingest, FastF1 data already stored for older seasons
- **1980–2017**: results only (no lap times; no sprint, format started 2021): Ergast via the `_legacy` jobs, rebuilt from F1DB by `backfill_results_from_f1db.py` (ADR 0009)

## Schedule (Render worker)

There are no Render cron jobs. `src/server.py` serves a health check and a login-protected dashboard
and runs `auto_runner.run_cycle` in a loop: every 20 minutes inside a race-weekend window, every 6 hours
outside it (those cycles never touch the DB). `src/weekend_pipeline.py` maps each Race Status to the
jobs due next once the session is over (sprint qualifying / sprint + 1.5 h, qualifying + 2 h, race + 3 h).
A session not published yet raises `SessionNotReady` and is retried next cycle. Typical timing:

### Conventional Weekend

| Time (UTC) | Jobs |
|------------|------|
| Saturday 22:00 | `ingest_qualifying` → `ingest_fp2` → `compute_features` |
| Sunday 18:00 | `ingest_race` → `compute_season_stats` → Race Events |

### Sprint Weekend

| Time (UTC) | Jobs |
|------------|------|
| Friday 22:00 | `ingest_sprint_qualifying` → `compute_sprint_features` |
| Saturday 16:00 | `ingest_sprint` → `compute_season_stats` |
| Saturday 22:00 | `ingest_qualifying` → `ingest_fp2` → `compute_features` |
| Sunday 18:00 | `ingest_race` → `compute_season_stats` → Race Events |

`compute_title_odds` and qualifying telemetry ride along as non-fatal steps.

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
| `DATABASE_URL` | Postgres connection string (psycopg2 TCP): Neon on Render, the local dev DB in `.env` |
| `PROD_DATABASE_URL` | Local only: Neon, for `dev_snapshot.py` / `backtest_snapshot.py` and explicit production writes |
| `DASHBOARD_USER` / `DASHBOARD_PASSWORD` | Worker dashboard login (no password: dashboard locked) |
| `NEON_API_KEY` / `NEON_PROJECT_ID` | Neon budget watchdog (`utils/neon_usage.py`, `scripts/neon_usage.py`); optional |

## Rules

- All jobs are idempotent: safe to re-run (`INSERT ... ON CONFLICT DO UPDATE`)
- Sprint qualifying ingest never overwrites existing sprint race finish positions (`exclude_update` guard)
- Jobs exit with code 1 on failure; in the worker a failed core step reverts the Race Status and is logged
- No `sleep()` inside jobs to wait for data: raise `SessionNotReady` and retry next cycle (only `openf1_client`'s pacing/backoff waits, ADR 0004)
- Never hold a DB connection across HTTP calls (OpenF1/Jolpica/FastF1): connect late, close early
- Structured logging: `{"job": "ingest_race", "round": 14, "status": "failed", "error": "..."}`
- Never write through the Hono API: connect directly to Neon
