#!/usr/bin/env bash
# Populates the DB with F1 data for 2021-2025.
# Run from data-engine/ directory with venv activated.

set -euo pipefail
LOG="/tmp/f1_populate.log"
exec > >(tee -a "$LOG") 2>&1

echo "[$(date)] Starting full F1 data population"

# Ingest all completed race rounds for a given year
ingest_year() {
  local year=$1
  local rounds=$2
  echo "[$(date)] === Ingesting $year races (1–$rounds) ==="
  for round in $(seq 1 $rounds); do
    echo -n "  Round $round ... "
    if python -m src.main --job ingest_race --year "$year" --round "$round" 2>&1 \
        | grep -qE 'Upserted|status → completed'; then
      echo "OK"
    else
      echo "SKIPPED/ERROR"
    fi
  done
  echo "[$(date)] Season stats for $year ..."
  python -m src.main --job compute_season_stats --year "$year" 2>&1 | tail -3
}

# 2025: skip round 1 (already done)
echo "[$(date)] === Ingesting 2025 races (2–24) ==="
for round in $(seq 2 24); do
  echo -n "  Round $round ... "
  python -m src.main --job ingest_race --year 2025 --round "$round" 2>&1 \
      | grep -E 'Upserted|status →|not available' | head -3 || true
done
python -m src.main --job compute_season_stats --year 2025 2>&1 | tail -3

# Now ingest qualifying for upcoming/latest race to enable predictions
echo "[$(date)] === Qualifying + predictions for Monaco 2025 (R8) ==="
python -m src.main --job ingest_qualifying --year 2025 --round 8 2>&1 | tail -3

# Get the race_id for Monaco 2025
RACE_ID=$(python -c "
from src.db.client import get_conn
conn = get_conn()
with conn.cursor() as c:
    c.execute(\"SELECT r.id FROM races r JOIN seasons s ON r.season_id=s.id WHERE s.year=2025 AND r.round_number=8\")
    print(c.fetchone()['id'])
conn.close()
" 2>/dev/null)

if [ -n "$RACE_ID" ]; then
  echo "[$(date)] compute_features race_id=$RACE_ID"
  python -m src.main --job compute_features --race_id "$RACE_ID" 2>&1 | tail -3
fi

# Historical years
ingest_year 2024 24
ingest_year 2023 22
ingest_year 2022 21
ingest_year 2021 19   # fewer rounds (Sochi/Istanbul excluded from DB)

echo "[$(date)] Population complete."
