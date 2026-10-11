"""Plans one season's repair from F1DB (CC-BY-4.0): the code fixes, missing drivers/teams and
the race/qualifying rows to rebuild. Pure: scripts/backfill_results_from_f1db.py does the I/O."""
import re
from dataclasses import dataclass, field
from typing import Any

from src.utils.driver_registry import team_key_for
from src.utils.f1db_results import match_f1db_driver, qualifying_row, race_row

RACE_FIELDS = ("finish_position", "grid_position", "points", "status", "total_race_time_ms", "fastest_lap")
QUALIFYING_FIELDS = ("grid_position", "q1_time_ms", "q2_time_ms", "q3_time_ms")
_NOT_ENTERED = {"DNQ", "DNPQ", "EX", "DNP"}

# Refs are our driver/team id (int) or, for rows this plan creates, the F1DB id (str).
Ref = int | str


@dataclass
class SeasonInput:
    season_id: int
    drivers: list[dict[str, Any]]
    teams: list[dict[str, Any]]
    races: list[dict[str, Any]]
    race_results: list[dict[str, Any]]
    qualifying_results: list[dict[str, Any]]
    f1db_drivers: dict[str, dict[str, Any]]
    f1db_constructors: dict[str, dict[str, Any]]
    f1db_races: dict[int, str]
    f1db_race_results: list[dict[str, Any]]
    f1db_qualifying: list[dict[str, Any]]


@dataclass(frozen=True)
class NewTeam:
    ref: str
    team_key: str
    name: str


@dataclass(frozen=True)
class NewDriver:
    ref: str
    code: str
    driver_number: int
    first_name: str
    last_name: str
    team_ref: Ref


@dataclass
class SeasonPlan:
    unmatched_drivers: list[int] = field(default_factory=list)
    date_mismatches: list[tuple[int, str, str]] = field(default_factory=list)
    code_fixes: dict[int, str] = field(default_factory=dict)
    new_teams: list[NewTeam] = field(default_factory=list)
    new_drivers: list[NewDriver] = field(default_factory=list)
    race_rows: list[dict[str, Any]] = field(default_factory=list)
    qualifying_rows: list[dict[str, Any]] = field(default_factory=list)
    race_deletes: list[tuple[int, int]] = field(default_factory=list)
    qualifying_deletes: list[tuple[int, int]] = field(default_factory=list)
    changed_race_rows: int = 0
    changed_qualifying_rows: int = 0
    merges: dict[int, int] = field(default_factory=dict)
    complete_races: list[int] = field(default_factory=list)


def _letters(value: str) -> str:
    return re.sub(r"[^a-z]", "", value.lower())


def _number(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _rebuild(plan_rows: list[dict[str, Any]], existing: list[dict[str, Any]], records: list[dict[str, Any]],
             to_row, fields: tuple[str, ...], race_id: int, ref_of: dict[str, Ref],
             keep: set[int]) -> tuple[int, list[tuple[int, int]]]:
    current = {r["driver_id"]: r for r in existing}
    wanted: set[Ref] = set()
    changed = 0
    for rec in records:
        ref = ref_of[rec["driverId"]]
        row = to_row(rec, race_id, ref)
        row["driver_ref"] = row.pop("driver_id")
        plan_rows.append(row)
        wanted.add(ref)
        old = current.get(ref)
        if old is None or any(_same(old.get(f)) != _same(row[f]) for f in fields):
            changed += 1
    # A driver F1DB couldn't place keeps their rows: absence from F1DB proves nothing about them.
    deletes = [(race_id, driver_id) for driver_id in current if driver_id not in wanted and driver_id not in keep]
    return changed, deletes


def _same(value: Any) -> Any:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else value


def plan_season(data: SeasonInput) -> SeasonPlan:
    plan = SeasonPlan()
    entrant_ids = {r["driverId"] for r in data.f1db_race_results} | {r["driverId"] for r in data.f1db_qualifying}
    entrants = [data.f1db_drivers[i] for i in entrant_ids]

    ref_of: dict[str, Ref] = {}
    for d in sorted(data.drivers, key=lambda d: d["id"]):
        match = match_f1db_driver(d["first_name"], d["last_name"], entrants)
        if match is None:
            plan.unmatched_drivers.append(d["id"])
            continue
        if match["id"] in ref_of:
            # Same person on a second row (a mid-season car-number change under the old key).
            plan.merges[d["id"]] = ref_of[match["id"]]
            continue
        ref_of[match["id"]] = d["id"]
        if match["abbreviation"] and d["code"] != match["abbreviation"]:
            plan.code_fixes[d["id"]] = match["abbreviation"]

    team_of = {_letters(t["team_key"]): t["id"] for t in data.teams} | {_letters(t["name"]): t["id"] for t in data.teams}
    first_entry = {}
    for rec in sorted(data.f1db_race_results + data.f1db_qualifying, key=lambda r: r["round"]):
        first_entry.setdefault(rec["driverId"], rec)
    new_team_refs: dict[str, Ref] = {}
    for f1db_id in sorted(entrant_ids - ref_of.keys()):
        rec = first_entry[f1db_id]
        constructor = data.f1db_constructors[rec["constructorId"]] if "constructorId" in rec else None
        team_ref: Ref | None = None
        if constructor:
            team_ref = team_of.get(_letters(constructor["id"])) or team_of.get(_letters(constructor["name"]))
            if team_ref is None:
                if constructor["id"] not in new_team_refs:
                    plan.new_teams.append(NewTeam(constructor["id"], team_key_for(constructor["name"]), constructor["name"]))
                    new_team_refs[constructor["id"]] = constructor["id"]
                team_ref = new_team_refs[constructor["id"]]
        driver = data.f1db_drivers[f1db_id]
        plan.new_drivers.append(NewDriver(
            ref=f1db_id, code=driver["abbreviation"], driver_number=_number(rec.get("driverNumber")),
            first_name=driver["firstName"], last_name=driver["lastName"],
            team_ref=team_ref if team_ref is not None else data.teams[0]["id"],
        ))
        ref_of[f1db_id] = f1db_id

    keep = set(plan.unmatched_drivers)
    for race in data.races:
        round_number = race["round_number"]
        ours, theirs = str(race["race_date"]), data.f1db_races.get(round_number)
        if theirs is None:
            continue
        if ours != theirs:
            plan.date_mismatches.append((round_number, ours, theirs))
            continue
        race_recs = [r for r in data.f1db_race_results if r["round"] == round_number and r["positionText"] not in _NOT_ENTERED]
        if race_recs and race.get("status", "completed") != "completed":
            plan.complete_races.append(race["id"])
        quali_recs = [r for r in data.f1db_qualifying if r["round"] == round_number]
        changed, deletes = _rebuild(plan.race_rows, [r for r in data.race_results if r["race_id"] == race["id"]],
                                    race_recs, race_row, RACE_FIELDS, race["id"], ref_of, keep)
        plan.changed_race_rows += changed
        plan.race_deletes += deletes
        changed, deletes = _rebuild(plan.qualifying_rows, [r for r in data.qualifying_results if r["race_id"] == race["id"]],
                                    quali_recs, qualifying_row, QUALIFYING_FIELDS, race["id"], ref_of, keep)
        plan.changed_qualifying_rows += changed
        plan.qualifying_deletes += deletes
    return plan
