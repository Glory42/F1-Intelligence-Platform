#!/usr/bin/env bash
# Backfill historical F1 data for 2018-2020.
# Only 2023+ re-ingests with full timing now (OpenF1, ADR 0011); 2018-2022 rounds fail and skip.
# Run from the data-engine/ directory with the venv active.
#
# Usage: bash scripts/backfill_historical.sh [start_year] [end_year]
#   Default: 2018 2020

set -e

START_YEAR=${1:-2018}
END_YEAR=${2:-2020}

# Round counts per season (including sprint weekends counted as rounds)
declare -A ROUND_COUNTS
ROUND_COUNTS[2018]=21
ROUND_COUNTS[2019]=21
ROUND_COUNTS[2020]=17
ROUND_COUNTS[2021]=22
ROUND_COUNTS[2022]=22
ROUND_COUNTS[2023]=22

for year in $(seq $START_YEAR $END_YEAR); do
  max_round=${ROUND_COUNTS[$year]:-22}
  echo ""
  echo "========================================"
  echo "  BACKFILLING $year  (${max_round} rounds)"
  echo "========================================"

  echo "-> sync_schedule $year"
  python -m src.main --job sync_schedule --year $year

  echo "-> sync_season $year round 1"
  python -m src.main --job sync_season --year $year --round 1

  for round in $(seq 1 $max_round); do
    echo ""
    echo "  [$year R$(printf '%02d' $round)] qualifying..."
    python -m src.main --job ingest_qualifying --year $year --round $round || echo "    WARN: qualifying failed for $year R$round (may not exist)"

    echo "  [$year R$(printf '%02d' $round)] race..."
    python -m src.main --job ingest_race --year $year --round $round || echo "    WARN: race failed for $year R$round"
  done

  echo "-> compute_season_stats $year"
  python -m src.main --job compute_season_stats --year $year

  echo "-> compute features + predictions for all $year races"
  python -c "
import sys; sys.path.insert(0, '.')
from src.db.client import get_conn
conn = get_conn()
cur = conn.cursor()
cur.execute('''
  SELECT r.id FROM races r
  JOIN seasons s ON r.season_id = s.id
  WHERE s.year = %s AND r.status = 'completed'
  ORDER BY r.race_date
''', ($year,))
race_ids = [row['id'] for row in cur.fetchall()]
conn.close()
print(f'  Found {len(race_ids)} completed races for $year')
for rid in race_ids:
    print(f'  features + predictions for race_id={rid}')
" 2>&1

  # Run compute_features and compute_predictions for each completed race
  python -c "
import sys, subprocess; sys.path.insert(0, '.')
from src.db.client import get_conn
conn = get_conn()
cur = conn.cursor()
cur.execute('''
  SELECT r.id FROM races r
  JOIN seasons s ON r.season_id = s.id
  WHERE s.year = $year AND r.status = %s
  ORDER BY r.race_date
''', ('completed',))
race_ids = [row['id'] for row in cur.fetchall()]
conn.close()
for rid in race_ids:
    r1 = subprocess.run(['python', '-m', 'src.main', '--job', 'compute_features', '--race_id', str(rid)], capture_output=False)
    r2 = subprocess.run(['python', '-m', 'src.main', '--job', 'compute_predictions', '--race_id', str(rid)], capture_output=False)
"

  echo ""
  echo "  ✓ $year complete"
done

echo ""
echo "========================================"
echo "  HISTORICAL BACKFILL COMPLETE"
echo "========================================"
