#!/usr/bin/env python3
"""Full historical backfill (default 2000-2026) in dependency order: sync, ingest,
sprint pipeline, then features/predictions. Full timing starts 2023 (OpenF1, ADR 0011), pre-2018 is Ergast results only; sprint format began 2021."""

import argparse
import sys

sys.path.insert(0, ".")
import src.config as _config  # triggers FastF1 cache + env setup

from src.db.client import get_conn
from src.weekend_pipeline import RaceRunContext, is_sprint_weekend, prediction_steps


# ── DB helpers ────────────────────────────────────────────────────────────────

def get_rounds(conn, year: int) -> list[dict]:
    """Return all rounds for a year with their race_id, sprint flag, and status."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT r.id, r.round_number, r.status,
                   r.event_format,
                   r.sprint_date IS NOT NULL AS has_sprint
            FROM races r
            JOIN seasons s ON r.season_id = s.id
            WHERE s.year = %s
            ORDER BY r.round_number
            """,
            (year,),
        )
        return [dict(row) for row in cur.fetchall()]


def get_completed_rounds(conn, year: int) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT r.id, r.round_number, r.event_format FROM races r
            JOIN seasons s ON r.season_id = s.id
            WHERE s.year = %s AND r.status = 'completed'
            ORDER BY r.race_date
            """,
            (year,),
        )
        return [dict(row) for row in cur.fetchall()]


# ── Per-job wrappers (all return True on success, False on failure) ───────────

def _run(label: str, fn, *args) -> bool:
    try:
        fn(*args)
        return True
    except Exception as e:
        print(f"    [SKIP] {label}: {e}")
        return False


# ── Main per-year logic ───────────────────────────────────────────────────────

def process_year(year: int) -> None:
    print(f"\n{'='*52}")
    print(f"  BACKFILL  {year}")
    print(f"{'='*52}")

    # 1 ── Sync schedule (idempotent: safe to re-run)
    print(f"\n[{year}] sync_schedule ...")
    from src.jobs.sync_schedule import run as sync_schedule
    if not _run(f"sync_schedule {year}", sync_schedule, year):
        print(f"  FATAL: sync_schedule failed for {year}, skipping year")
        return

    # 2 ── Sync season (drivers + teams): try round 1 first, fall back to 2
    print(f"[{year}] sync_season ...")
    from src.jobs.sync_season import run as sync_season
    if not _run(f"sync_season {year} r1", sync_season, year, 1):
        _run(f"sync_season {year} r2", sync_season, year, 2)

    # 3 ── Per-round ingestion
    conn = get_conn()
    rounds = get_rounds(conn, year)
    conn.close()

    if not rounds:
        print(f"  No rounds found for {year}: skipping")
        return

    print(f"[{year}] ingesting {len(rounds)} rounds ...")

    from src.jobs.ingest_qualifying import run as ingest_qualifying
    from src.jobs.ingest_race       import run as ingest_race

    for r in rounds:
        rn = r["round_number"]
        tag = f"{year} R{rn:02d}"

        # Main qualifying
        _run(f"{tag} ingest_qualifying", ingest_qualifying, year, rn)

        # Main race
        _run(f"{tag} ingest_race",       ingest_race,       year, rn)

    # SQ session has no classification, so load "S" (has grid + finish) instead.
    sprint_rounds = [r for r in rounds if r["has_sprint"]]
    if sprint_rounds:
        print(f"[{year}] ingesting {len(sprint_rounds)} sprint rounds ...")
        from src.jobs.ingest_sprint import run as ingest_sprint
        for r in sprint_rounds:
            _run(f"{year} R{r['round_number']:02d} ingest_sprint", ingest_sprint, year, r["round_number"])

    # 5 ── Season stats (includes sprint aggregates)
    print(f"[{year}] compute_season_stats ...")
    from src.jobs.compute_season_stats import run as css
    _run(f"compute_season_stats {year}", css, year)

    # 6 ── Every completed weekend's predictions: sprint and GP, as the worker would build them
    conn = get_conn()
    completed = get_completed_rounds(conn, year)
    conn.close()

    print(f"[{year}] predictions for {len(completed)} completed rounds ...")
    for r in completed:
        ctx = RaceRunContext(race_id=r["id"], year=year, round_number=r["round_number"])
        for step in prediction_steps(is_sprint_weekend(r["event_format"])):
            _run(f"{year} R{r['round_number']:02d} {step.name}", step.run, ctx)

    print(f"\n  ✓ {year} complete")


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Full F1 historical backfill (2000–2026)")
    parser.add_argument("--start", type=int, default=2000, help="First year (default 2000)")
    parser.add_argument("--end",   type=int, default=2026, help="Last year  (default 2026)")
    args = parser.parse_args()

    years = list(range(args.start, args.end + 1))
    print(f"Backfilling {len(years)} years: {years[0]}–{years[-1]}")

    for year in years:
        try:
            process_year(year)
        except Exception as e:
            print(f"\n  ERROR in year {year}: {e}, continuing to next year")

    print(f"\n{'='*52}")
    print("  FULL BACKFILL COMPLETE")
    print(f"{'='*52}\n")


if __name__ == "__main__":
    main()
