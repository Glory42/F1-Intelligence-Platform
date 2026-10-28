---
name: backfill
description: Run historical F1 data backfill jobs. Use when the user says "backfill", "run backfill", "populate data", or asks to ingest historical race/qualifying data for specific years.
---

# Backfill Skill: F1 Prediction Data Engine

Run ETL jobs to populate historical race data, features, and predictions.

## Working Directory

Always run from `data-engine/` with the venv active:

```bash
cd /home/glory42/projects/side-projects/F1-prediction/data-engine
source venv/bin/activate
```

## Data Coverage

| Era | Job type | Notes |
|-----|----------|-------|
| 2023–present | `ingest_qualifying` + `ingest_race` | Full timing from OpenF1 + Jolpica (ADR 0011) |
| 2018–2022 | already stored | Can't be re-ingested: FastF1 timing needs F1TV and OpenF1 starts 2023 |
| 2000–2017 | `ingest_qualifying_legacy` + `ingest_race_legacy` | Ergast results only, no lap times |

## Round Counts

```python
ROUND_COUNTS = {
    2000: 17, 2001: 17, 2002: 17, 2003: 16, 2004: 18,
    2005: 19, 2006: 18, 2007: 17, 2008: 18, 2009: 17,
    2010: 19, 2011: 19, 2012: 20, 2013: 19, 2014: 19,
    2015: 19, 2016: 21, 2017: 20, 2018: 21, 2019: 21,
    2020: 17, 2021: 22, 2022: 22, 2023: 22,
}
```

## Full Year Backfill (recommended)

Use `scripts/run_backfill.py` for one or more years. It handles sync → ingest → compute automatically, routing each
year by `session_kind.results_ingest_for`: legacy Ergast jobs before 2018, OpenF1 + Jolpica from 2023, and it skips
2018–2022 (that timing can't be re-ingested, ADR 0011):

```bash
# Single year
python scripts/run_backfill.py 2025 2025

# Range
python scripts/run_backfill.py 2005 2017

# Background with log
python scripts/run_backfill.py 2023 2026 > /tmp/backfill_2023_2026.log 2>&1 &
```

## Individual Jobs

```bash
# 1. Sync race schedule for a year
python -m src.main --job sync_schedule --year 2022

# 2. Sync driver/team roster
python -m src.main --job sync_season --year 2022 --round 1

# 3. Ingest qualifying (2018+)
python -m src.main --job ingest_qualifying --year 2022 --round 5

# 3. Ingest qualifying (pre-2018)
python -m src.main --job ingest_qualifying_legacy --year 2010 --round 5

# 4. Ingest race results
python -m src.main --job ingest_race --year 2022 --round 5
python -m src.main --job ingest_race_legacy --year 2010 --round 5

# 5. Compute season stats (after all races ingested)
python -m src.main --job compute_season_stats --year 2022

# 6. Compute features for a specific race
python -m src.main --job compute_features --race_id 42

# 7. Compute predictions for a specific race
python -m src.main --job compute_predictions --race_id 42
```

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
  WHERE s.year BETWEEN 2000 AND 2026
  GROUP BY s.year ORDER BY s.year DESC
''')
for row in cur.fetchall():
    print(dict(row))
conn.close()
"
```

## Rules

- Jobs are idempotent: safe to re-run
- `safe()` wrapper in `scripts/run_backfill.py` catches per-round failures and continues
- Pre-2018 qualifying sessions may return 0 drivers (Ergast coverage is sparse): this is expected
- Do NOT deploy to Cloudflare after backfill: DB writes are live immediately
