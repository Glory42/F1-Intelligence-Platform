---
name: backfill
description: Run historical F1 data backfill jobs. Use when the user says "backfill", "run backfill", "populate data", or asks to ingest historical race/qualifying data for specific years.
---

# Backfill Skill: F1 Intelligence Platform Data Engine

Run ETL jobs to populate historical race data, features, and predictions.

## Working Directory

Always run from `data-engine/` with the venv active (Python 3.12):

```bash
cd /home/glory42/Projects/side-projects/F1-prediction/data-engine
source venv/bin/activate
```

Every job and script writes to whatever `DATABASE_URL` points at: the local `docker-compose.dev.yml` DB
for development, Neon only when the user means to change production.

## Data Coverage

Each season goes to the jobs that can serve it (`session_kind.results_ingest_for`):

| Era | Source | Notes |
|-----|--------|-------|
| 2023–present | `ingest_qualifying` + `ingest_race` (+ sprint jobs) | Full timing from OpenF1 + Jolpica (ADR 0011) |
| 2018–2022 | already stored | Can't be re-ingested: FastF1 timing needs F1TV and OpenF1 starts 2023. Enrichment only via `scripts/backfill_fastf1_enrichment.py` / `backfill_race_story.py` from a local FastF1 cache |
| 1980–2017 | `scripts/backfill_results_from_f1db.py` | F1DB is the source of truth for pre-2018 results (ADR 0009); results only, no lap times |
| pre-2018 (old path) | `ingest_qualifying_legacy` + `ingest_race_legacy` | Ergast results through FastF1; not CLI jobs, run by `run_backfill.py` / `backfill_full.py` |

## Full Year Backfill

`scripts/run_backfill.py` (positional start/end years) handles sync → ingest → season stats → features for each
year, routing it by `results_ingest_for` (legacy jobs before 2018, OpenF1 + Jolpica from 2023, skips 2018–2022):

```bash
python scripts/run_backfill.py 2025 2025          # single year
python scripts/run_backfill.py 2023 2026 > /tmp/backfill_2023_2026.log 2>&1 &
```

`scripts/backfill_full.py --start 2000 --end 2026` does the same in dependency order including the sprint pipeline
and every prediction step (`weekend_pipeline.prediction_steps`).

## Other Backfills (local only)

```bash
python scripts/backfill_results_from_f1db.py --from 1980 --to 2017 [--apply]   # dry run without --apply
python scripts/audit_results_vs_f1db.py [--modern-plan]                        # read-only check after any backfill
python scripts/backfill_openf1.py ingest_stints 2023 2026 [--session Sprint] [--refresh]
python scripts/backfill_fastf1_enrichment.py 2018 2022 [--only stints,pits,race_control,telemetry] [--refresh]
python scripts/backfill_race_story.py 2018 2022
python scripts/backfill_sprint.py --years 2025 2026
python scripts/backfill_fp2.py
python scripts/backfill_title_odds.py 2018 2026
python scripts/backfill_all_predictions.py [--from 2018] [--skip-sprint]       # GP fitted per season, out-of-sample
```

## Individual Jobs

Job names come from `src/jobs/registry.py` (`python -m src.main --job <name>`). A round-scoped job without
`--year/--round` runs on the latest round whose Race Status says it is due.

```bash
python -m src.main --job sync_schedule --year 2026
python -m src.main --job sync_season --year 2026 --round 1
python -m src.main --job ingest_qualifying --year 2026 --round 5
python -m src.main --job ingest_race --year 2026 --round 5
python -m src.main --job ingest_sprint_qualifying --year 2026 --round 6
python -m src.main --job ingest_sprint --year 2026 --round 6
python -m src.main --job ingest_race_story --year 2026 --round 5 --session Sprint
python -m src.main --job compute_season_stats --year 2026
python -m src.main --job compute_title_odds --year 2026
python -m src.main --job compute_features --race_id 42           # GP features + prediction (weighted-v4)
python -m src.main --job compute_sprint_features --race_id 42    # sprint features + prediction (sprint-v3)
```

Session enrichment jobs (`--session Race|Sprint`): `ingest_race_control`, `ingest_overtakes`, `ingest_team_radio`,
`ingest_stints`, `ingest_pit_stops`, `ingest_race_story`, `ingest_qualifying_telemetry`. Also `ingest_fp2`,
`data_quality_audit [--all]`, `data_quality_repair --resolve_run N`.

## Check Progress

```python
# Run this to see ingestion + prediction status across all years
python -c "
import sys; sys.path.insert(0, '.')
from src.db.client import get_conn
conn = get_conn()
cur = conn.cursor()
cur.execute('''
  SELECT s.year,
    COUNT(r.id) races,
    COUNT(CASE WHEN r.status = 'completed' THEN 1 END) done,
    COUNT(DISTINCT dpf.race_id) features,
    COUNT(DISTINCT rp.race_id) predictions
  FROM seasons s
  LEFT JOIN races r ON r.season_id = s.id
  LEFT JOIN driver_prediction_features dpf ON dpf.race_id = r.id
  LEFT JOIN race_predictions rp ON rp.race_id = r.id
  WHERE s.year BETWEEN 1980 AND 2026
  GROUP BY s.year ORDER BY s.year DESC
''')
for row in cur.fetchall():
    print(dict(row))
conn.close()
"
```

## Rules

- Jobs are idempotent: safe to re-run
- Backfills run locally in bounded chunks, never on Render; against Neon, check `storage_guard`
  (`src/utils/storage_guard.py`) first and watch the free-tier budget (`python scripts/neon_usage.py`)
- `safe()` in `scripts/run_backfill.py` retries each step and continues past per-round failures
- Pre-2018 qualifying sessions may return 0 drivers (Ergast coverage is sparse): this is expected
- Do NOT deploy to Cloudflare after backfill. Neon has the data at once, but the API's R2 snapshot store
  holds old answers until the next race weekend: bump `SNAPSHOT_VERSION` in `apps/api/wrangler.toml` and ship it
