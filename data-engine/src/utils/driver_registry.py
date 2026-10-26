"""Registers the drivers and teams an OpenF1 session lists, so results are never dropped for a
driver the season doesn't know yet (mid-season replacements, stand-ins, rookies)."""
from dataclasses import dataclass
from typing import Any

import pandas as pd


@dataclass(frozen=True)
class SessionEntry:
    driver_number: int
    code: str
    first_name: str
    last_name: str
    team_key: str
    team_name: str
    nationality: str | None


def _present(value: Any) -> bool:
    # NaN is truthy: a missing FastF1 field once became driver code "NAN".
    return value is not None and not (isinstance(value, float) and pd.isna(value)) and str(value).strip() != ""


def team_key_for(team_name: str) -> str:
    return team_name.lower().replace(" ", "_").replace("-", "_").replace(".", "")


def _driver_code(abbreviation: Any, first_name: str, last_name: str, driver_number: int) -> str:
    if _present(abbreviation):
        return str(abbreviation).upper()[:3]
    source = last_name or first_name
    code = "".join(c for c in source if c.isalpha())[:3].upper()
    if len(code) < 3:
        code = (code + str(driver_number))[:3].upper()
    return code


def session_entries(drivers: list[dict[str, Any]]) -> list[SessionEntry]:
    """drivers: OpenF1 /drivers rows for one session."""
    entries = []
    for info in drivers:
        try:
            driver_number = int(info.get("driver_number") or 0)
        except (ValueError, TypeError):
            driver_number = 0
        first_name = str(info.get("first_name") or "").strip()
        last_name = str(info.get("last_name") or "").strip()
        if not first_name and not last_name:
            first_name, _, last_name = str(info.get("full_name") or f"Driver {driver_number}").partition(" ")
        team_name = str(info.get("team_name") or "Unknown")
        country = info.get("country_code")
        entries.append(SessionEntry(
            driver_number=driver_number,
            code=_driver_code(info.get("name_acronym"), first_name, last_name, driver_number),
            first_name=first_name,
            last_name=last_name,
            team_key=team_key_for(team_name),
            team_name=team_name,
            nationality=str(country) if _present(country) else None,
        ))
    return entries


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
