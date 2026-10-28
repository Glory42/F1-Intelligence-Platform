from src.db.client import get_conn
from src.session_kind import BY_NAME
from src.utils.driver_registry import season_drivers
from src.utils.ingest_runner import write_session_story
from src.utils.openf1_session import STORY_PARTS, lap_records, load_session, session_weather_trace
from src.utils.race_story import session_story
from src.utils.storage_guard import read_storage_tier


def run(year: int, round_num: int, session_name: str = "Race") -> None:
    """Race story on its own, for a race that completed while storage was tight (the race
    ingest skips it then). Fetches OpenF1 with no connection open, then one short write."""
    race_session = BY_NAME[session_name]
    print(f"[ingest_race_story] year={year} round={round_num} session={session_name}")
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT r.id, r.season_id, r.race_date, r.sprint_date, r.openf1_race_session_key, r.openf1_sprint_session_key "
                "FROM races r JOIN seasons s ON r.season_id = s.id "
                "WHERE s.year = %s AND r.round_number = %s",
                (year, round_num),
            )
            race = cur.fetchone()
        if race is None:
            raise ValueError(f"Race not found for year={year} round={round_num}")
        if session_name == "Sprint" and race["sprint_date"] is None:
            return
        if not read_storage_tier(conn).allows_optional:
            print("  [SKIP] Neon storage tier blocks optional enrichment")
            return
    finally:
        conn.close()

    session = load_session(year, race["race_date"], race_session.code, STORY_PARTS,
                           session_key=race[race_session.key_column])
    story = session_story(lap_records(session), session_weather_trace(session))
    conn = get_conn()
    try:
        write_session_story(conn, race["id"], race_session.tag, story, season_drivers(conn, race["season_id"]).by_code)
        conn.commit()
    finally:
        conn.close()
    print(f"  {race_session.tag}: {len(story.traces)} traces, {len(story.battles)} battles")
