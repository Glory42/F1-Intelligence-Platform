"""Backfills race-story tables (lap traces, battles, weather) for completed races from FastF1, so
2018+ and only from the local cache now that FastF1 timing needs F1TV (ADR 0011). Writes nothing
else. Run locally, never on Render (FastF1 loads need RAM and bandwidth).
Usage: python scripts/backfill_race_story.py 2018 2025"""
import argparse
import sys

sys.path.insert(0, ".")

from src.db.client import get_conn
from src.enrichment_coverage import backfill_allowed
from src.utils.driver_registry import season_drivers
from src.utils.fastf1_session import get_session, lap_records, session_weather_trace
from src.utils.ingest_runner import write_session_story
from src.utils.race_story import session_story

SESSIONS = (("R", "race"), ("S", "sprint"))


def completed_races(start: int, end: int) -> list[dict]:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT r.id, r.season_id, r.round_number, r.sprint_date, s.year FROM races r
                   JOIN seasons s ON r.season_id = s.id
                   WHERE s.year BETWEEN %s AND %s AND r.status = 'completed'
                   ORDER BY s.year, r.round_number""",
                (start, end),
            )
            return cur.fetchall()
    finally:
        conn.close()


def backfill_session(race: dict, fastf1_session: str, tag: str) -> None:
    # FastF1 is loaded with no DB connection open (Neon compute), then one short write.
    session = get_session(race["year"], race["round_number"], fastf1_session)
    story = session_story(lap_records(session), session_weather_trace(session))
    conn = get_conn()
    try:
        if not backfill_allowed(conn):
            raise SystemExit(1)
        write_session_story(conn, race["id"], tag, story, season_drivers(conn, race["season_id"]).by_code)
        conn.commit()
    finally:
        conn.close()
    print(f"  {tag}: {len(story.traces)} traces, {len(story.battles)} battles, weather={'yes' if story.weather else 'no'}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("start", type=int, nargs="?", default=2018)
    parser.add_argument("end", type=int, nargs="?", default=2025)
    args = parser.parse_args()

    races = completed_races(args.start, args.end)
    print(f"Backfilling race story for {len(races)} completed races ({args.start}-{args.end})")
    for i, race in enumerate(races, 1):
        print(f"[{i}/{len(races)}] {race['year']} R{race['round_number']:02d}")
        for fastf1_session, tag in SESSIONS:
            if tag == "sprint" and race["sprint_date"] is None:
                continue
            try:
                backfill_session(race, fastf1_session, tag)
            except SystemExit:
                raise
            except Exception as e:
                print(f"  [WARN] {tag} failed: {e}")
