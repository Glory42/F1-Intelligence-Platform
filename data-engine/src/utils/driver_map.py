def build_driver_code_map(conn, season_id: int) -> dict[str, int]:
    with conn.cursor() as cur:
        cur.execute("SELECT id, code FROM drivers WHERE season_id = %s", (season_id,))
        return {row["code"]: row["id"] for row in cur.fetchall()}


def build_driver_number_map(conn, season_id: int) -> dict[int, int]:
    """OpenF1 identifies drivers by car number, not code: this maps that number to our
    season-scoped driver_id for OpenF1-sourced jobs (ingest_overtakes, ingest_team_radio)."""
    with conn.cursor() as cur:
        cur.execute("SELECT id, driver_number FROM drivers WHERE season_id = %s", (season_id,))
        return {row["driver_number"]: row["id"] for row in cur.fetchall()}
