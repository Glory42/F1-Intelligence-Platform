"""A season's drivers: registering the ones a session lists, so results are never dropped for a driver the
season doesn't know yet (mid-season replacements, stand-ins, rookies), and finding them again by number or code."""
from dataclasses import dataclass
from typing import Any, Optional


@dataclass(frozen=True)
class SessionEntry:
    driver_number: int
    code: str
    first_name: str
    last_name: str
    team_key: str
    team_name: str
    nationality: str | None


def team_key_for(team_name: str) -> str:
    return team_name.lower().replace(" ", "_").replace("-", "_").replace(".", "")


@dataclass(frozen=True)
class SeasonDrivers:
    """One season's driver rows, found by car number (OpenF1) or by code (FastF1, the legacy jobs)."""

    by_number: dict[int, int]
    by_code: dict[str, int]

    def id_for(self, number: Optional[int] = None, code: Optional[str] = None) -> Optional[int]:
        if number is not None and number in self.by_number:
            return self.by_number[number]
        return self.by_code.get(code) if code else None


def season_drivers(conn: Any, season_id: int) -> SeasonDrivers:
    with conn.cursor() as cur:
        cur.execute("SELECT id, code, driver_number FROM drivers WHERE season_id = %s", (season_id,))
        rows = cur.fetchall()
    return SeasonDrivers(
        by_number={r["driver_number"]: r["id"] for r in rows if r["driver_number"] is not None},
        by_code={r["code"]: r["id"] for r in rows if r["code"]},
    )


def register_session_drivers(
    conn: Any, season_id: int, entries: list[SessionEntry], *, update_existing: bool = False
) -> dict[str, int]:
    """Returns code -> driver_id for the season, including every entry. Matches by code, then by
    name; plain SELECT-then-INSERT so it works whichever unique index `drivers` carries."""
    with conn.cursor() as cur:
        cur.execute("SELECT id, team_key FROM teams WHERE season_id = %s", (season_id,))
        team_ids = {r["team_key"]: r["id"] for r in cur.fetchall()}
        for entry in entries:
            if entry.team_key in team_ids:
                continue
            cur.execute(
                "INSERT INTO teams (season_id, team_key, name, nationality) VALUES (%s, %s, %s, NULL) RETURNING id",
                (season_id, entry.team_key, entry.team_name),
            )
            team_ids[entry.team_key] = cur.fetchone()["id"]
            print(f"  Registered team {entry.team_name}")

        cur.execute("SELECT id, code, first_name, last_name FROM drivers WHERE season_id = %s", (season_id,))
        known = cur.fetchall()
        by_code = {r["code"]: r["id"] for r in known}
        by_name = {(r["first_name"].lower(), r["last_name"].lower()): r["id"] for r in known}

        driver_map = dict(by_code)
        for entry in entries:
            driver_id = by_code.get(entry.code) or by_name.get((entry.first_name.lower(), entry.last_name.lower()))
            team_id = team_ids[entry.team_key]
            if driver_id is None:
                cur.execute(
                    "INSERT INTO drivers (season_id, team_id, driver_number, code, first_name, last_name, nationality) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                    (season_id, team_id, entry.driver_number, entry.code, entry.first_name, entry.last_name, entry.nationality),
                )
                driver_id = cur.fetchone()["id"]
                print(f"  Registered driver {entry.code} #{entry.driver_number} ({entry.first_name} {entry.last_name})")
            elif update_existing:
                cur.execute(
                    "UPDATE drivers SET team_id = %s, driver_number = %s, first_name = %s, last_name = %s, "
                    "nationality = COALESCE(%s, nationality) WHERE id = %s",
                    (team_id, entry.driver_number, entry.first_name, entry.last_name, entry.nationality, driver_id),
                )
            driver_map[entry.code] = driver_id
    return driver_map
