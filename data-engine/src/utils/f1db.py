from dataclasses import dataclass
import re
import unicodedata

_SUFFIX = re.compile(r"\s+(jr|sr|ii|iii)\.?$")


def normalize_person_name(name: str) -> str:
    """Join key between core drivers ("Sergio Perez") and F1DB ("Sergio Pérez", "Carlos Sainz Jr.").
    Mirrored by apps/api/src/modules/history/f1db-match.helpers.ts — keep both in step."""
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    collapsed = " ".join(ascii_name.lower().split())
    return _SUFFIX.sub("", collapsed)


@dataclass
class Milestones:
    first_race: tuple[str, str] | None = None
    first_win: tuple[str, str] | None = None
    first_podium: tuple[str, str] | None = None
    first_pole: tuple[str, str] | None = None


def career_milestones(race_results: list[dict], races: list[dict]) -> dict[str, Milestones]:
    """F1DB race results → each driver's first start / win / podium / pole as (date, race name)."""
    race_by_id = {r["id"]: r for r in races}
    ordered = sorted(race_results, key=lambda r: race_by_id[r["raceId"]]["date"])
    milestones: dict[str, Milestones] = {}
    for result in ordered:
        race = race_by_id[result["raceId"]]
        event = (race["date"], race["officialName"])
        m = milestones.setdefault(result["driverId"], Milestones())
        m.first_race = m.first_race or event
        position = result.get("positionNumber")
        if position == 1 and m.first_win is None:
            m.first_win = event
        if position is not None and position <= 3 and m.first_podium is None:
            m.first_podium = event
        if result.get("polePosition") and m.first_pole is None:
            m.first_pole = event
    return milestones


def _milestone_columns(prefix: str, event: tuple[str, str] | None) -> dict:
    return {f"{prefix}_date": event[0] if event else None, f"{prefix}_name": event[1] if event else None}


def driver_row(record: dict, milestones: Milestones | None) -> dict:
    m = milestones or Milestones()
    return {
        "f1db_id": record["id"],
        "match_key": normalize_person_name(record["name"]),
        "name": record["name"],
        "abbreviation": record.get("abbreviation"),
        "date_of_birth": record.get("dateOfBirth"),
        "date_of_death": record.get("dateOfDeath"),
        "nationality": record.get("nationalityCountryId"),
        "championships": record.get("totalChampionshipWins") or 0,
        "race_starts": record.get("totalRaceStarts") or 0,
        "race_wins": record.get("totalRaceWins") or 0,
        "podiums": record.get("totalPodiums") or 0,
        "pole_positions": record.get("totalPolePositions") or 0,
        "fastest_laps": record.get("totalFastestLaps") or 0,
        "career_points": record.get("totalPoints") or 0,
        "sprint_wins": record.get("totalSprintRaceWins") or 0,
        "grand_slams": record.get("totalGrandSlams") or 0,
        **_milestone_columns("first_race", m.first_race),
        **_milestone_columns("first_win", m.first_win),
        **_milestone_columns("first_podium", m.first_podium),
        **_milestone_columns("first_pole", m.first_pole),
    }


def constructor_seasons(
    chassis_rows: list[dict], engine_rows: list[dict], chassis_names: dict[str, str], engine_names: dict[str, str],
) -> list[dict]:
    """One row per constructor per season; a team running several chassis/engines in a year
    (common in the 1950s–60s) gets them joined with ' / '."""
    chassis: dict[tuple[str, int], list[str]] = {}
    engines: dict[tuple[str, int], list[str]] = {}
    for r in chassis_rows:
        names = chassis.setdefault((r["constructorId"], r["year"]), [])
        name = chassis_names.get(r["chassisId"], r["chassisId"])
        if name not in names:
            names.append(name)
    for r in engine_rows:
        names = engines.setdefault((r["constructorId"], r["year"]), [])
        name = engine_names.get(r["engineManufacturerId"], r["engineManufacturerId"])
        if name not in names:
            names.append(name)
    keys = sorted(set(chassis) | set(engines), key=lambda k: (k[0], k[1]))
    return [
        {"constructor_f1db_id": c, "year": y, "chassis": " / ".join(chassis.get((c, y), [])) or None,
         "engine": " / ".join(engines.get((c, y), [])) or None}
        for c, y in keys
    ]


def constructor_row(record: dict) -> dict:
    return {
        "f1db_id": record["id"],
        "name": record["name"],
        "full_name": record.get("fullName"),
        "country": record.get("countryId"),
        "championships": record.get("totalChampionshipWins") or 0,
        "race_starts": record.get("totalRaceStarts") or 0,
        "race_wins": record.get("totalRaceWins") or 0,
        "podiums": record.get("totalPodiums") or 0,
        "pole_positions": record.get("totalPolePositions") or 0,
        "fastest_laps": record.get("totalFastestLaps") or 0,
        "career_points": record.get("totalPoints") or 0,
    }
