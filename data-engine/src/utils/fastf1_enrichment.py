"""FastF1 → the OpenF1-shaped enrichment tables (stints, pit stops, race control, lap telemetry)
for seasons OpenF1 doesn't cover (2018–2022). Converters take plain records so they test
without FastF1; the session_* helpers do the DataFrame → records step."""
from datetime import datetime
from typing import Any, Optional

import pandas as pd

from src.enrichment_coverage import normalize_compound
from src.utils.telemetry import LapWindow

# A lane visit longer than this is a red-flag wait in the pit lane, not a pit stop.
MAX_PIT_LANE_MS = 120_000


def _present(value: Any) -> bool:
    return value is not None and not (isinstance(value, float) and pd.isna(value)) and value is not pd.NaT


def _int_or_none(value: Any) -> Optional[int]:
    return int(value) if _present(value) else None


def _td_ms(value: Any) -> Optional[int]:
    return int(pd.to_timedelta(value).total_seconds() * 1000) if _present(value) else None


def _utc(value: Any) -> Optional[datetime]:
    if not _present(value):
        return None
    ts = pd.Timestamp(value)
    return (ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")).to_pydatetime()


def stint_rows(laps: list[dict], code_map: dict[str, int], race_id: int, session_type: str) -> list[dict]:
    """One row per (driver, stint): first/last lap, the stint's compound, tyre age when fitted.
    2018 timing leaves lap 1 without a stint or tyre age: laps before a driver's first numbered
    stint belong to it, and the age is worked back from the first lap that has one."""
    by_driver: dict[str, list[dict]] = {}
    for lap in laps:
        by_driver.setdefault(lap["Driver"], []).append(lap)
    rows = []
    for code, driver_laps in by_driver.items():
        driver_id = code_map.get(code)
        ordered = sorted(driver_laps, key=lambda l: l["LapNumber"])
        first_stint = next((_int_or_none(l.get("Stint")) for l in ordered if _present(l.get("Stint"))), None)
        if driver_id is None or first_stint is None:
            continue
        stints: dict[int, dict] = {}
        for lap in ordered:
            stint = _int_or_none(lap.get("Stint"))
            if stint is None:
                if stints:
                    continue
                stint = first_stint
            number = int(lap["LapNumber"])
            row = stints.setdefault(stint, {
                "race_id": race_id, "session_type": session_type, "driver_id": driver_id, "stint_number": stint,
                "compound": None, "lap_start": number, "lap_end": number, "tyre_age_at_start": None,
            })
            row["lap_end"] = number
            if row["compound"] is None:
                row["compound"] = normalize_compound(lap.get("Compound"))
            tyre_life = _int_or_none(lap.get("TyreLife"))
            if row["tyre_age_at_start"] is None and tyre_life is not None:
                # TyreLife counts the current lap, so a fresh set reads 1 on its first lap.
                row["tyre_age_at_start"] = max(tyre_life - 1 - (number - row["lap_start"]), 0)
        rows.extend(stints.values())
    return rows


def pit_stop_rows(laps: list[dict], code_map: dict[str, int], race_id: int, session_type: str) -> list[dict]:
    """A stop is an in-lap's PitInTime to the next lap's PitOutTime; FastF1 has no stationary time."""
    by_driver: dict[str, list[dict]] = {}
    for lap in laps:
        by_driver.setdefault(lap["Driver"], []).append(lap)
    rows = []
    for code, driver_laps in by_driver.items():
        driver_id = code_map.get(code)
        if driver_id is None:
            continue
        ordered = sorted(driver_laps, key=lambda l: l["LapNumber"])
        for lap, out_lap in zip(ordered, ordered[1:]):
            pit_in, pit_out = lap.get("PitInTime"), out_lap.get("PitOutTime")
            if not _present(pit_in) or not _present(pit_out):
                continue
            lane_ms = _td_ms(pd.to_timedelta(pit_out) - pd.to_timedelta(pit_in))
            if lane_ms is None or lane_ms <= 0 or lane_ms > MAX_PIT_LANE_MS:
                continue
            date = None
            if _present(lap.get("LapStartDate")) and _present(lap.get("LapStartTime")):
                date = _utc(pd.Timestamp(lap["LapStartDate"]) + (pd.to_timedelta(pit_in) - pd.to_timedelta(lap["LapStartTime"])))
            rows.append({
                "race_id": race_id, "session_type": session_type, "driver_id": driver_id,
                "lap_number": int(lap["LapNumber"]), "pit_lane_ms": lane_ms, "stationary_ms": None, "date": date,
            })
    return rows


def race_control_rows(messages: list[dict], race_id: int, session_type: str) -> list[dict]:
    rows = []
    for m in messages:
        date = _utc(m.get("Time"))
        if date is None or not _present(m.get("Message")):
            continue
        racing_number = m.get("RacingNumber")
        rows.append({
            "race_id": race_id, "session_type": session_type, "date": date,
            "category": m.get("Category") or "Other",
            "flag": m.get("Flag") if _present(m.get("Flag")) else None,
            "lap_number": _int_or_none(m.get("Lap")),
            "driver_number": int(racing_number) if _present(racing_number) and str(racing_number).isdigit() else None,
            "scope": m.get("Scope") if _present(m.get("Scope")) else None,
            "sector": _int_or_none(m.get("Sector")),
            "message": m["Message"],
        })
    # The table is unique on (race, date, message): FastF1 occasionally repeats a message.
    return list({(r["date"], r["message"]): r for r in rows}.values())


def _iso(value: Any) -> str:
    ts = pd.Timestamp(value)
    return (ts.tz_localize("UTC") if ts.tzinfo is None else ts).isoformat()


def telemetry_inputs(car: list[dict], pos: list[dict], lap_number: int, lap_start: Any, lap_time: Any) -> tuple[list[dict], list[dict], LapWindow]:
    """FastF1 car/position samples → the OpenF1 car_data/location shape build_lap_telemetry reads."""
    car_data = [
        {"date": _iso(s["Date"]), "speed": float(s["Speed"]), "throttle": float(s["Throttle"]),
         "brake": bool(s["Brake"]), "n_gear": int(s["nGear"])}
        for s in car
    ]
    location = [{"date": _iso(p["Date"]), "x": float(p["X"]), "y": float(p["Y"])} for p in pos]
    start = pd.Timestamp(lap_start)
    window = LapWindow(
        lap_number=int(lap_number),
        start=(start.tz_localize("UTC") if start.tzinfo is None else start).to_pydatetime(),
        lap_ms=int(pd.to_timedelta(lap_time).total_seconds() * 1000),
    )
    return car_data, location, window


def session_lap_records(session: Any) -> list[dict]:
    return session.laps.to_dict("records")


def session_message_records(session: Any) -> list[dict]:
    return session.race_control_messages.to_dict("records")


def fastest_lap_inputs(session: Any) -> list[tuple[str, list[dict], list[dict], LapWindow]]:
    """Each driver's fastest timed qualifying lap as (code, car_data, location, window)."""
    out = []
    for code in session.laps["Driver"].dropna().unique():
        lap = session.laps.pick_drivers(code).pick_fastest()
        if lap is None or not _present(lap.get("LapTime")) or not _present(lap.get("LapStartDate")):
            continue
        try:
            car = lap.get_car_data().to_dict("records")
            pos = lap.get_pos_data().to_dict("records")
        except Exception as e:
            print(f"  [SKIP] {code}: no telemetry ({e})")
            continue
        if len(car) < 2 or len(pos) < 2:
            continue
        out.append((code, *telemetry_inputs(car, pos, lap["LapNumber"], lap["LapStartDate"], lap["LapTime"])))
    return out

