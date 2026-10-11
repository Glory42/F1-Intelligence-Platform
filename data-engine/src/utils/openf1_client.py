import time
from datetime import date, datetime
from typing import Any
from urllib.parse import quote

import requests

BASE_URL = "https://api.openf1.org/v1"
_TIMEOUT_S = 10
_MAX_DATE_DRIFT_DAYS = 1  # covers night races (e.g. Las Vegas) crossing into the next UTC day
_MAX_ATTEMPTS = 3
_RETRY_BACKOFF_S = (1.0, 2.0)
_RETRYABLE_STATUS = {429, 500, 502, 503, 504}

# OpenF1's free tier allows ~30 requests/min; a cycle that needs more (e.g. telemetry)
# must resume next cycle instead of bursting past the limit.
DEFAULT_REQUEST_BUDGET = 25

_MIN_REQUEST_INTERVAL_S = 2.0

_sleep = time.sleep
_monotonic = time.monotonic
_remaining_requests: int | None = None
_last_request_at: float | None = None


class OpenF1BudgetExceeded(RuntimeError):
    pass


def reset_request_budget(limit: int | None = DEFAULT_REQUEST_BUDGET) -> None:
    """None = unlimited (manual CLI runs); pacing still keeps those under the rate limit."""
    global _remaining_requests
    _remaining_requests = limit


def remaining_requests() -> int | None:
    return _remaining_requests


def _spend_request() -> None:
    global _remaining_requests, _last_request_at
    if _remaining_requests is not None:
        if _remaining_requests <= 0:
            raise OpenF1BudgetExceeded("OpenF1 request budget for this cycle is spent")
        _remaining_requests -= 1
    if _last_request_at is not None:
        wait = _MIN_REQUEST_INTERVAL_S - (_monotonic() - _last_request_at)
        if wait > 0:
            _sleep(wait)
    _last_request_at = _monotonic()


def _get(path: str, params: dict[str, Any], operator_filters: str = "") -> Any:
    """OpenF1 returns 404 {"detail": "No results found."} (not 200 + []) for any query
    that matches zero rows, on every endpoint we use. Treat that as an empty list rather
    than an error; every caller here expects a list back regardless."""
    for attempt in range(_MAX_ATTEMPTS):
        last_attempt = attempt == _MAX_ATTEMPTS - 1
        _spend_request()
        try:
            resp = requests.get(f"{BASE_URL}/{path}{operator_filters}", params=params, timeout=_TIMEOUT_S)
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
            if last_attempt:
                raise
            _sleep(_RETRY_BACKOFF_S[attempt])
            continue
        if resp.status_code not in _RETRYABLE_STATUS or last_attempt:
            break
        _sleep(_RETRY_BACKOFF_S[attempt])
    if resp.status_code == 404:
        return []
    resp.raise_for_status()
    return resp.json()


def get_session_key(year: int, session_date: Any, session_name: str = "Race") -> int:
    """OpenF1's circuit naming doesn't line up 1:1 with our circuit_key values, so matching
    the session by closest start date is the reliable join key instead. session_name is
    "Race" for the Sunday GP or "Sprint" for the Saturday sprint session: both are covered
    by OpenF1 (2023+ only)."""
    sessions = _get("sessions", {"year": year, "session_name": session_name})
    if not sessions:
        # OpenF1 has no coverage before 2023, hence the empty list from _get above.
        raise ValueError(f"OpenF1 has no session data for year={year} session={session_name}")

    if isinstance(session_date, datetime):
        target = session_date.date()
    elif isinstance(session_date, date):
        target = session_date
    else:
        target = datetime.strptime(str(session_date), "%Y-%m-%d").date()

    closest = min(sessions, key=lambda s: abs((datetime.fromisoformat(s["date_start"]).date() - target).days))
    drift = abs((datetime.fromisoformat(closest["date_start"]).date() - target).days)
    if drift > _MAX_DATE_DRIFT_DAYS:
        raise ValueError(f"No OpenF1 {session_name} session found for year={year} date={target}")
    return closest["session_key"]


def fetch_race_control(session_key: int) -> list[dict]:
    return _get("race_control", {"session_key": session_key})


def fetch_overtakes(session_key: int) -> list[dict]:
    return _get("overtakes", {"session_key": session_key})


def fetch_team_radio(session_key: int) -> list[dict]:
    return _get("team_radio", {"session_key": session_key})


def fetch_stints(session_key: int) -> list[dict]:
    return _get("stints", {"session_key": session_key})


def fetch_pit_stops(session_key: int) -> list[dict]:
    return _get("pit", {"session_key": session_key})



def _time_window(start: datetime, end: datetime) -> str:
    """OpenF1 range filters are `date>=X` / `date<=Y` (operator, no `=` separator), which requests'
    params would encode as `date>==X`: so they're appended to the path pre-encoded."""
    return f"?date%3E%3D{quote(start.isoformat(), safe=':')}&date%3C%3D{quote(end.isoformat(), safe=':')}"


def fetch_laps(session_key: int) -> list[dict]:
    return _get("laps", {"session_key": session_key})


def fetch_car_data(session_key: int, driver_number: int, start: datetime, end: datetime) -> list[dict]:
    return _get("car_data", {"session_key": session_key, "driver_number": driver_number}, _time_window(start, end))


def fetch_location(session_key: int, driver_number: int, start: datetime, end: datetime) -> list[dict]:
    return _get("location", {"session_key": session_key, "driver_number": driver_number}, _time_window(start, end))
