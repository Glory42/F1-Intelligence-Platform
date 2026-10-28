"""Full historical backfill runner (positional args, no --help: start year, end year).
Each season goes to the jobs that can serve it (session_kind.results_ingest_for): the legacy Ergast jobs
before 2018, the OpenF1 + Jolpica jobs from 2023; 2018–2022 is skipped, its stored rows stay (ADR 0011).
Usage: python scripts/run_backfill.py 2023 2025"""
import sys
import traceback

sys.path.insert(0, ".")
import src.config  # noqa: triggers FastF1 cache setup

from src.db.client import get_conn
from src.jobs.sync_schedule import run as sync_schedule
from src.jobs.sync_season import run as sync_season
from src.jobs.ingest_qualifying import run as ingest_qualifying
from src.jobs.ingest_race import run as ingest_race
from src.jobs.compute_season_stats import run as compute_season_stats
from src.jobs.compute_features import run as compute_features
from src.session_kind import OPENF1_FIRST_YEAR, ResultsIngest, results_ingest_for

# Round counts per year
ROUND_COUNTS = {
    1980: 14, 1981: 15, 1982: 16, 1983: 15, 1984: 16,
    1985: 16, 1986: 16, 1987: 16, 1988: 16, 1989: 16,
    1990: 16, 1991: 16, 1992: 16, 1993: 16, 1994: 16,
    1995: 17, 1996: 16, 1997: 17, 1998: 16, 1999: 16,
    2000: 17, 2001: 17, 2002: 17, 2003: 16, 2004: 18,
    2005: 19, 2006: 18, 2007: 17, 2008: 18, 2009: 17,
    2010: 19, 2011: 19, 2012: 20, 2013: 19, 2014: 19,
    2015: 19, 2016: 21, 2017: 20, 2018: 21, 2019: 21,
    2020: 17, 2021: 22, 2022: 22, 2023: 22,
}


import time
import random

def safe(fn, *args, **kwargs) -> bool:
    max_retries = 4
    for attempt in range(max_retries):
        try:
            fn(*args, **kwargs)
            time.sleep(2.5)  # Generous stagger to avoid Ergast 429 rate limit
            return True
        except Exception as e:
            if attempt < max_retries - 1:
                # Longer backoff (10s, 20s, 30s) to clear any rate limits
                sleep_time = 10 * (attempt + 1) + random.uniform(1.0, 3.0)
                print(f"  [WARN] {fn.__name__} failed: {e}. Retrying (attempt {attempt + 2}/{max_retries}) in {sleep_time:.1f}s...")
                time.sleep(sleep_time)
            else:
                print(f"  [WARN] {fn.__name__} failed after {max_retries} attempts: {e}")
    return False


def get_completed_race_ids(year: int) -> list[int]:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT r.id FROM races r
                   JOIN seasons s ON r.season_id = s.id
                   WHERE s.year = %s AND r.status = 'completed'
                   ORDER BY r.race_date""",
                (year,),
            )
            return [row["id"] for row in cur.fetchall()]
    finally:
        conn.close()


def backfill_year(year: int) -> None:
    max_round = ROUND_COUNTS.get(year, 22)
    ingest = results_ingest_for(year)
    if ingest is None:
        print(f"\n[SKIP] {year}: its lap timing can't be re-ingested (ADR 0011), stored rows stay. Its enrichment "
              "comes from scripts/backfill_fastf1_enrichment.py and a local FastF1 cache.")
        return
    legacy = ingest is ResultsIngest.LEGACY
    print(f"\n{'='*52}")
    print(f"  BACKFILLING {year}  ({max_round} rounds)  {'[LEGACY]' if legacy else ''}")
    print(f"{'='*52}")

    if not safe(sync_schedule, year):
        print(f"  [ERROR] sync_schedule failed for {year}. Skipping this year.")
        return
    if not legacy:
        # sync_season reads OpenF1's entry list; the legacy jobs work from drivers already stored.
        safe(sync_season, year, 1)

    if legacy:
        from src.jobs.ingest_qualifying_legacy import run as ingest_q_legacy
        from src.jobs.ingest_race_legacy import run as ingest_r_legacy
        q_fn, r_fn = ingest_q_legacy, ingest_r_legacy
    else:
        q_fn, r_fn = ingest_qualifying, ingest_race

    for r in range(1, max_round + 1):
        print(f"\n  [{year} R{r:02d}]")
        if not legacy:
            safe(sync_season, year, r)
        safe(q_fn, year, r)
        safe(r_fn, year, r)

    safe(compute_season_stats, year)

    race_ids = get_completed_race_ids(year)
    print(f"\n  Features+predictions for {len(race_ids)} completed races...")
    for rid in race_ids:
        safe(compute_features, rid)

    print(f"\n  ✓ {year} done")


if __name__ == "__main__":
    start = int(sys.argv[1]) if len(sys.argv) > 1 else OPENF1_FIRST_YEAR
    end   = int(sys.argv[2]) if len(sys.argv) > 2 else start

    for year in range(start, end + 1):
        try:
            backfill_year(year)
            if year < end:
                print("\nSleeping 30 seconds to cool down Jolpica API rate limit...")
                time.sleep(30)
        except Exception:
            print(f"\n[ERROR] Year {year} aborted:")
            traceback.print_exc()

    print("\n\n✓ BACKFILL COMPLETE")
