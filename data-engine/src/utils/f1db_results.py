"""Pure helpers for restoring results from F1DB (CC-BY-4.0): which F1DB driver one of our
season-scoped driver rows is, and the race_results / qualifying_results rows for an F1DB record."""
from typing import Any

from src.utils.f1db import normalize_person_name

# Our rows (from Ergast) name a few drivers differently from F1DB.
_ALIASES = {"jyrki jarvilehto": "jj lehto"}

_UNCLASSIFIED = {"DSQ": "Disqualified", "DNS": "Did not start", "NC": "Not classified"}


def _surname(name: str) -> str:
    parts = normalize_person_name(name).split()
    return parts[-1] if parts else ""


def match_f1db_driver(first_name: str, last_name: str, season_drivers: list[dict[str, Any]]) -> dict[str, Any] | None:
    full = normalize_person_name(f"{first_name} {last_name}")
    full = _ALIASES.get(full, full)
    exact = [d for d in season_drivers
             if full in (normalize_person_name(d["name"]), normalize_person_name(d["fullName"]))]
    if len(exact) == 1:
        return exact[0]
    by_surname = [d for d in season_drivers if _surname(d["lastName"]) == _surname(last_name)]
    return by_surname[0] if len(by_surname) == 1 else None


def race_status(rec: dict[str, Any]) -> str:
    """Status strings in the shape isClassifiedFinish (ADR 0002) reads: Finished / +N Lap(s) / reason."""
    if rec["positionNumber"] is not None:
        laps = rec.get("gapLaps")
        return f"+{laps} Lap{'s' if laps > 1 else ''}" if laps else "Finished"
    return _UNCLASSIFIED.get(rec["positionText"]) or rec.get("reasonRetired") or "Retired"


def race_row(rec: dict[str, Any], race_id: int, driver_id: int) -> dict[str, Any]:
    return {
        "race_id": race_id,
        "driver_id": driver_id,
        "finish_position": rec["positionNumber"],
        "grid_position": rec.get("gridPositionNumber") or 0,
        "points": float(rec.get("points") or 0),
        "status": race_status(rec)[:30],
        "total_race_time_ms": rec.get("timeMillis"),
        "fastest_lap": bool(rec.get("fastestLap")),
    }


def qualifying_row(rec: dict[str, Any], race_id: int, driver_id: int) -> dict[str, Any]:
    # Before knockout qualifying (2006) there's one time per driver, kept as q1.
    return {
        "race_id": race_id,
        "driver_id": driver_id,
        "grid_position": rec["positionNumber"] or rec["positionDisplayOrder"],
        "q1_time_ms": rec.get("q1Millis") or rec.get("timeMillis"),
        "q2_time_ms": rec.get("q2Millis"),
        "q3_time_ms": rec.get("q3Millis"),
    }
