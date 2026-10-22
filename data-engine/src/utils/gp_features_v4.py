"""weighted-v4 candidate features: one value per driver per GP, in real units (no per-race min-max),
higher is better, using only races before this one. Form is a decayed average over each person's or
outfit's recent races across seasons, so round 1 isn't blind and a team change doesn't reset a driver."""
import math
from collections import defaultdict
from statistics import median
from typing import Any, Optional

from src.utils.race_history import RaceHistory

# Everything gp_features computes; the backtest tries subsets of it.
CANDIDATE_FEATURES: tuple[str, ...] = (
    "grid",
    "quali_pace",
    "long_run_pace",
    "team_points",
    "team_quali_pace",
    "team_reliability",
    "driver_points",
    "driver_wins",
    "teammate_edge",
    "team_race_pace",
    "sprint_result",
    "grid_processional",
    "grid_chaos",
)
# What weighted-v4 uses: chosen on 2018–2021, confirmed on 2022–2026 (docs/prediction-model.md § Backtest).
# The rest added nothing beyond noise: driver wins and team points repeat driver points, practice long runs
# and team DNF rate carried ~0 weight, and the sprint result and safety-car rate made it slightly worse.
GP_V4_FEATURES: tuple[str, ...] = (
    "grid",
    "quali_pace",
    "team_quali_pace",
    "driver_points",
    "teammate_edge",
    "grid_processional",
    "team_race_pace",
)

# Finishing positions are scored on the 2010+ table in every era, so form compares across seasons.
POINTS = (25, 18, 15, 12, 10, 8, 6, 4, 2, 1)
FORM_RACES = 12
FORM_DECAY = 0.85
# Past races scanned per target race: enough for FORM_RACES appearances by anyone racing regularly.
LOOKBACK_RACES = 40
QUALI_GAP_CAP = 5.0
TEAMMATE_EDGE_CAP = 2.0
LONG_RUN_MIN_COVERAGE = 0.5
BACK_OF_GRID = 20
# races.safety_car_laps / vsc_laps are only filled from 2018 (earlier rows hold the default 0).
NEUTRALISATION_DATA_FROM = 2018
# A circuit's own safety-car rate counts like this many races of the all-circuit rate.
CIRCUIT_SHRINK_RACES = 3
DEFAULT_OVERTAKE_RATE = 0.5


def finish_points(position: Optional[int]) -> float:
    return float(POINTS[position - 1]) if position and 1 <= position <= len(POINTS) else 0.0


def is_dnf(status: Optional[str]) -> bool:
    """Lead-lap, FastF1-lapped and Ergast "+N Laps" finishes are classified; everything else is a DNF
    (ADR 0002: DSQ and DNS included)."""
    return not (status in ("Finished", "Lapped") or (status or "").startswith("+"))


def quali_gaps(rows: list[dict[str, Any]]) -> dict[int, float]:
    """% behind the fastest time in the deepest session each driver reached (Q3, else Q2, else Q1),
    capped; a driver with no time gets the cap."""
    fastest = {}
    for col in ("q1_time_ms", "q2_time_ms", "q3_time_ms"):
        times = [r[col] for r in rows if r[col]]
        if times:
            fastest[col] = min(times)
    gaps = {}
    for r in rows:
        col = next((c for c in ("q3_time_ms", "q2_time_ms", "q1_time_ms") if r[c] and c in fastest), None)
        gap = (r[col] / fastest[col] - 1) * 100 if col else QUALI_GAP_CAP
        gaps[r["driver_id"]] = min(gap, QUALI_GAP_CAP)
    return gaps


def long_run_gaps(rows: list[dict[str, Any]], driver_ids: list[int]) -> dict[int, float]:
    """% off the best practice long run on the same compound, the driver's best compound. Missing
    drivers get the field median; a session too thin to compare gives everyone 0 (no signal)."""
    best = {}
    for r in rows:
        best[r["compound"]] = min(best.get(r["compound"], r["median_lap_ms"]), r["median_lap_ms"])
    gaps: dict[int, float] = {}
    for r in rows:
        gap = min((r["median_lap_ms"] / best[r["compound"]] - 1) * 100, QUALI_GAP_CAP)
        gaps[r["driver_id"]] = min(gaps.get(r["driver_id"], gap), gap)
    known = [gaps[d] for d in driver_ids if d in gaps]
    if len(known) < len(driver_ids) * LONG_RUN_MIN_COVERAGE:
        return {d: 0.0 for d in driver_ids}
    fill = median(known)
    return {d: gaps.get(d, fill) for d in driver_ids}


def pace_gaps(rows: list[dict[str, Any]]) -> dict[int, float]:
    """% behind the fastest median clean race lap, capped."""
    fastest = min(r["median_lap_ms"] for r in rows)
    return {r["driver_id"]: min((r["median_lap_ms"] / fastest - 1) * 100, QUALI_GAP_CAP) for r in rows}


def neutralisation_rate(h: RaceHistory, past: list[int], circuit_id: int) -> float:
    """Share of past races with a safety car or VSC at this circuit, shrunk toward all circuits."""
    seen = [h.races[r] for r in past if h.races[r]["year"] >= NEUTRALISATION_DATA_FROM]
    if not seen:
        return 0.5
    overall = sum(1 for r in seen if r["neutralised"]) / len(seen)
    here = [r for r in seen if r["circuit_id"] == circuit_id]
    hits = sum(1 for r in here if r["neutralised"])
    return (hits + CIRCUIT_SHRINK_RACES * overall) / (len(here) + CIRCUIT_SHRINK_RACES)


def decayed_mean(values_recent_first: list[float]) -> Optional[float]:
    values = values_recent_first[:FORM_RACES]
    if not values:
        return None
    weights = [FORM_DECAY**i for i in range(len(values))]
    return sum(w * v for w, v in zip(weights, values)) / sum(weights)


def _race_summary(h: RaceHistory, race_id: int) -> dict[str, dict[str, float]]:
    """One past race, keyed by person / outfit: points, win, DNF, qualifying gap, teammate edge."""
    key = ("v4-summary", race_id)
    if key in h.memo:
        return h.memo[key]
    s: dict[str, dict[str, float]] = defaultdict(dict)
    car_points: dict[str, list[float]] = defaultdict(list)
    car_dnf: dict[str, list[float]] = defaultdict(list)
    for r in h.results.get(race_id, []):
        person, outfit = h.person.get(r["driver_id"]), h.outfit.get(r["team_id"])
        pts = 0.0 if is_dnf(r["status"]) else finish_points(r["finish_position"])
        if person:
            s["driver_points"][person] = pts
            s["driver_wins"][person] = 1.0 if r["finish_position"] == 1 else 0.0
        if outfit:
            car_points[outfit].append(pts)
            car_dnf[outfit].append(1.0 if is_dnf(r["status"]) else 0.0)
    s["team_points"] = {o: sum(v) / len(v) for o, v in car_points.items()}
    s["team_dnf"] = {o: sum(v) / len(v) for o, v in car_dnf.items()}

    rows = h.quali.get(race_id, [])
    if any(r["q1_time_ms"] for r in rows):
        gaps = quali_gaps(rows)
        by_outfit: dict[str, list[tuple[str, float]]] = defaultdict(list)
        for r in rows:
            person, outfit = h.person.get(r["driver_id"]), h.outfit.get(r["team_id"])
            if person and outfit:
                by_outfit[outfit].append((person, gaps[r["driver_id"]]))
        for outfit, cars in by_outfit.items():
            s["team_quali_gap"][outfit] = min(g for _, g in cars)
            for person, gap in cars:
                mates = [g for p, g in cars if p != person]
                if mates:
                    edge = sum(mates) / len(mates) - gap
                    s["teammate_edge"][person] = max(-TEAMMATE_EDGE_CAP, min(TEAMMATE_EDGE_CAP, edge))
    pace = h.race_pace.get(race_id, [])
    if pace:
        for driver_id, gap in pace_gaps(pace).items():
            outfit = h.outfit.get(h.team_of.get(driver_id))
            if outfit:
                s["team_race_gap"][outfit] = min(gap, s["team_race_gap"].get(outfit, gap))
    h.memo[key] = s
    return s


def _form(h: RaceHistory, past: list[int], metric: str, who: str) -> Optional[float]:
    return decayed_mean([s[metric][who] for s in (_race_summary(h, r) for r in past) if who in s[metric]])


def gp_features(h: RaceHistory, race_id: int) -> dict[int, dict[str, float]]:
    """driver_id → CANDIDATE_FEATURES for every driver on this race's qualifying sheet."""
    rows = h.quali.get(race_id, [])
    if not rows:
        raise ValueError(f"No qualifying results for race {race_id}")
    driver_ids = [r["driver_id"] for r in rows]
    race = h.races[race_id]
    past = h.completed_before(race["race_date"])[:LOOKBACK_RACES]
    gaps = quali_gaps(rows)
    # Safety cars are rare enough per circuit that the rate needs more history than form does.
    chaos = neutralisation_rate(h, h.completed_before(race["race_date"]), race["circuit_id"])
    processional = 1 - float(race["overtake_rate"] if race["overtake_rate"] is not None else DEFAULT_OVERTAKE_RATE)
    sprint = {
        r["driver_id"]: 0.0 if is_dnf(r["status"]) else finish_points(r["finish_position"])
        for r in h.sprints.get(race_id, [])
    }
    race_gap = {r["driver_id"]: _form(h, past, "team_race_gap", h.outfit.get(r["team_id"], "")) for r in rows}
    known_gap = [v for v in race_gap.values() if v is not None]
    field_gap = median(known_gap) if known_gap else 0.0
    long_runs = long_run_gaps(h.long_runs.get(race_id, []), driver_ids)

    team_dnf = {r["driver_id"]: _form(h, past, "team_dnf", h.outfit.get(r["team_id"], "")) for r in rows}
    known_dnf = [v for v in team_dnf.values() if v is not None]
    field_dnf = sum(known_dnf) / len(known_dnf) if known_dnf else 0.0

    out = {}
    for r in rows:
        person, outfit = h.person.get(r["driver_id"], ""), h.outfit.get(r["team_id"], "")
        grid = r["grid_position"] if r["grid_position"] and r["grid_position"] > 0 else BACK_OF_GRID
        team_gap = _form(h, past, "team_quali_gap", outfit)
        dnf = team_dnf[r["driver_id"]]
        out[r["driver_id"]] = {
            "grid": -math.log(grid),
            "quali_pace": -gaps[r["driver_id"]],
            "long_run_pace": -long_runs[r["driver_id"]],
            # A new outfit or a rookie has no form: they start from nothing, not from the field average.
            "team_points": _form(h, past, "team_points", outfit) or 0.0,
            "team_quali_pace": -(team_gap if team_gap is not None else QUALI_GAP_CAP),
            "team_reliability": -(dnf if dnf is not None else field_dnf),
            "driver_points": _form(h, past, "driver_points", person) or 0.0,
            "driver_wins": _form(h, past, "driver_wins", person) or 0.0,
            "teammate_edge": _form(h, past, "teammate_edge", person) or 0.0,
            "team_race_pace": -(race_gap[r["driver_id"]] if race_gap[r["driver_id"]] is not None else field_gap),
            "sprint_result": sprint.get(r["driver_id"], 0.0),
            "grid_processional": -math.log(grid) * processional,
            "grid_chaos": -math.log(grid) * chaos,
        }
    return out
