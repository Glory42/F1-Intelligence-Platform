import fastf1
import pandas as pd
from typing import Any

Session = Any  # fastf1 has no type stubs; Session is Session at runtime


def get_session(year: int, round_num: int, session_type: str, messages: bool = False) -> Session:
    session = fastf1.get_session(year, round_num, session_type)
    telemetry = session_type in ("FP1", "FP2", "FP3")
    session.load(laps=True, telemetry=telemetry, weather=True, messages=messages)
    return session


def ms_to_int(val) -> int | None:
    """Convert a pandas timedelta-like value to integer milliseconds."""
    if pd.isna(val):
        return None
    try:
        td = pd.to_timedelta(val)
        return int(td.total_seconds() * 1000)
    except Exception:
        return None


def session_to_quali_results(session: Session) -> list[dict[str, Any]]:
    results = session.results

    # Build best sector times per driver from laps
    sector_map: dict[str, dict[str, Any]] = {}
    try:
        laps = session.laps
        for driver_code, grp in laps.groupby("Driver"):
            code = str(driver_code).upper()
            s1 = grp["Sector1Time"].dropna()
            s2 = grp["Sector2Time"].dropna()
            s3 = grp["Sector3Time"].dropna()
            st = grp["SpeedST"].dropna() if "SpeedST" in grp.columns else pd.Series(dtype=float)
            sector_map[code] = {
                "sector1_ms": int(s1.min().total_seconds() * 1000) if len(s1) > 0 else None,
                "sector2_ms": int(s2.min().total_seconds() * 1000) if len(s2) > 0 else None,
                "sector3_ms": int(s3.min().total_seconds() * 1000) if len(s3) > 0 else None,
                "speed_st": round(float(st.max()), 1) if len(st) > 0 else None,
            }
    except Exception:
        pass

    rows = []
    for _, row in results.iterrows():
        if pd.isna(row.get("Position")):
            continue
        code = str(row["Abbreviation"]).upper()
        sectors = sector_map.get(code, {})
        rows.append({
            "driver_code": code,
            "grid_position": int(row["Position"]),
            "q1_time_ms": ms_to_int(row.get("Q1")),
            "q2_time_ms": ms_to_int(row.get("Q2")),
            "q3_time_ms": ms_to_int(row.get("Q3")),
            "sector1_ms": sectors.get("sector1_ms"),
            "sector2_ms": sectors.get("sector2_ms"),
            "sector3_ms": sectors.get("sector3_ms"),
            "speed_st": sectors.get("speed_st"),
        })
    return rows


def session_to_race_results(session: Session) -> list[dict[str, Any]]:
    results = session.results

    # Extract headshot URLs from results if available
    headshot_map: dict[str, str | None] = {}
    for _, row in results.iterrows():
        code = str(row.get("Abbreviation", "")).upper()
        url = row.get("HeadshotUrl")
        if url and not pd.isna(url) and str(url).startswith("http"):
            headshot_map[code] = str(url)
        else:
            headshot_map[code] = None

    # Derive fastest lap from lap times — FastF1 results don't have a FastestLap column
    fastest_lap_driver: str | None = None
    try:
        laps = session.laps
        valid = laps.dropna(subset=["LapTime"])
        valid = valid[valid["LapTime"] > pd.Timedelta(0)]
        if not valid.empty:
            fastest_lap_driver = str(valid.loc[valid["LapTime"].idxmin(), "Driver"]).upper()
    except Exception:
        pass

    rows = []
    for _, row in results.iterrows():
        finish_pos = None
        if not pd.isna(row.get("Position")):
            finish_pos = int(row["Position"])

        total_ms = None
        if not pd.isna(row.get("Time")):
            total_ms = int(pd.to_timedelta(row["Time"]).total_seconds() * 1000)

        code = str(row["Abbreviation"]).upper()
        rows.append({
            "driver_code": code,
            "finish_position": finish_pos,
            "grid_position": int(row["GridPosition"]) if not pd.isna(row.get("GridPosition")) else 20,
            "points": float(row["Points"]) if not pd.isna(row.get("Points")) else 0.0,
            "status": str(row.get("Status", "Unknown")),
            "total_race_time_ms": total_ms,
            "fastest_lap": code == fastest_lap_driver,
            "headshot_url": headshot_map.get(code),
        })
    return rows


def session_to_lap_times(session: Session) -> list[dict[str, Any]]:
    try:
        laps = session.laps.pick_accurate()
    except Exception:
        laps = session.laps

    rows = []
    for _, lap in laps.iterrows():
        lap_ms = None
        if not pd.isna(lap.get("LapTime")):
            lap_ms = int(pd.to_timedelta(lap["LapTime"]).total_seconds() * 1000)

        s1_ms = s2_ms = s3_ms = None
        if not pd.isna(lap.get("Sector1Time")):
            s1_ms = int(pd.to_timedelta(lap["Sector1Time"]).total_seconds() * 1000)
        if not pd.isna(lap.get("Sector2Time")):
            s2_ms = int(pd.to_timedelta(lap["Sector2Time"]).total_seconds() * 1000)
        if not pd.isna(lap.get("Sector3Time")):
            s3_ms = int(pd.to_timedelta(lap["Sector3Time"]).total_seconds() * 1000)

        speed_st = None
        if "SpeedST" in lap and not pd.isna(lap.get("SpeedST")):
            speed_st = round(float(lap["SpeedST"]), 1)

        tyre_life = None
        if "TyreLife" in lap and not pd.isna(lap.get("TyreLife")):
            tyre_life = int(lap["TyreLife"])

        fresh_tyre = None
        if "FreshTyre" in lap and not pd.isna(lap.get("FreshTyre")):
            fresh_tyre = bool(lap["FreshTyre"])

        stint_number = None
        if "Stint" in lap.index and not pd.isna(lap.get("Stint")):
            stint_number = int(lap["Stint"])

        rows.append({
            "driver_code": str(lap["Driver"]).upper(),
            "lap_number": int(lap["LapNumber"]),
            "lap_time_ms": lap_ms,
            "sector1_ms": s1_ms,
            "sector2_ms": s2_ms,
            "sector3_ms": s3_ms,
            "speed_st": speed_st,
            "compound": str(lap.get("Compound", "UNKNOWN")).upper() if not pd.isna(lap.get("Compound")) else None,
            "tyre_life": tyre_life,
            "fresh_tyre": fresh_tyre,
            "is_pit_lap": bool(lap.get("PitInTime") is not None and not pd.isna(lap.get("PitInTime"))),
            "stint_number": stint_number,
        })
    return rows


def get_weather(session: Session) -> str:
    try:
        weather_df = session.weather_data
        if weather_df.empty:
            return "dry"
        avg_rain = weather_df["Rainfall"].mean() if "Rainfall" in weather_df else 0
        if avg_rain > 0.5:
            return "wet"
        if avg_rain > 0.1:
            return "mixed"
        return "dry"
    except Exception:
        return "dry"


def get_weather_details(session: Session) -> dict[str, float | None]:
    try:
        w = session.weather_data
        if w.empty:
            return {"air_temp_avg": None, "track_temp_avg": None, "humidity_avg": None}
        return {
            "air_temp_avg": round(float(w["AirTemp"].mean()), 1) if "AirTemp" in w else None,
            "track_temp_avg": round(float(w["TrackTemp"].mean()), 1) if "TrackTemp" in w else None,
            "humidity_avg": round(float(w["Humidity"].mean()), 1) if "Humidity" in w else None,
        }
    except Exception:
        return {"air_temp_avg": None, "track_temp_avg": None, "humidity_avg": None}


def get_sc_vsc_laps(session: Session) -> dict[str, int]:
    """Count unique lap numbers affected by Safety Car (4) or VSC (6)."""
    try:
        laps = session.laps
        if "TrackStatus" not in laps.columns:
            return {"safety_car_laps": 0, "vsc_laps": 0}

        sc = laps[laps["TrackStatus"].astype(str).str.contains("4", na=False)]["LapNumber"].nunique()
        vsc = laps[laps["TrackStatus"].astype(str).str.contains("6", na=False)]["LapNumber"].nunique()
        return {"safety_car_laps": int(sc), "vsc_laps": int(vsc)}
    except Exception:
        return {"safety_car_laps": 0, "vsc_laps": 0}


def validate_session_data(session: Session, session_type: str) -> bool:
    """
    Validates if the FastF1 session results and lap times are complete and correct.
    Returns True if valid, False if data contains placeholders/nulls/empty values.
    """
    # 1. Basic checks
    if session.results is None or session.results.empty:
        print("[validate_session_data] Session results are missing or empty.")
        return False

    # 2. Check position validity: at least 10 drivers must have non-null, non-zero positions
    valid_positions = session.results["Position"].dropna()
    valid_positions = valid_positions[valid_positions > 0]
    if len(valid_positions) < 10:
        print(f"[validate_session_data] Only found {len(valid_positions)} valid finishing positions.")
        return False

    # 3. Check winner (Position 1) has a valid finish time (timedelta > 0)
    winner_row = session.results[session.results["Position"] == 1.0]
    if winner_row.empty:
        winner_row = session.results.iloc[0:1]

    if not winner_row.empty:
        winner_time = winner_row.iloc[0].get("Time")
        if pd.isna(winner_time) or winner_time == pd.Timedelta(0):
            print("[validate_session_data] Winner has no valid Time duration.")
            return False

    # 4. Check lap count
    if session.laps is None or session.laps.empty:
        print("[validate_session_data] Laps dataframe is missing or empty.")
        return False

    total_laps = len(session.laps)
    min_laps = 50 if session_type == "S" else 100
    if total_laps < min_laps:
        print(f"[validate_session_data] Total laps count {total_laps} is below minimum {min_laps}.")
        return False

    return True



def session_to_lap_records(session) -> list[dict]:
    """Every lap with a position and end time — deliberately NOT pick_accurate(): the race story
    needs in/out laps too, or every pit stop would leave a hole in the gap chart."""
    records = []
    for _, lap in session.laps.iterrows():
        if pd.isna(lap.get("Position")) or pd.isna(lap.get("Time")) or pd.isna(lap.get("LapNumber")):
            continue
        records.append({
            "driver": str(lap["Driver"]).upper(),
            "lap": int(lap["LapNumber"]),
            "position": int(lap["Position"]),
            "time_ms": int(lap["Time"].total_seconds() * 1000),
        })
    return records


def session_weather_trace(session):
    """None when FastF1 has no weather samples for the session."""
    from src.utils.race_story import weather_trace

    weather = getattr(session, "weather_data", None)
    if weather is None:
        return None
    weather = weather.dropna(subset=["Time", "AirTemp", "TrackTemp", "Rainfall"])
    if weather.empty:
        return None
    return weather_trace(weather)
