"""Jolpica-F1 (the free Ergast successor): the official classification of a race or sprint.
OpenF1 has no grid or finish-status text, and FastF1 took both from this same source."""
import time
from typing import Any

import requests

BASE_URL = "https://api.jolpi.ca/ergast/f1"
_TIMEOUT_S = 15
_RETRY_BACKOFF_S = (1.0, 2.0)
_RETRYABLE_STATUS = {429, 500, 502, 503, 504}

_sleep = time.sleep


def _get(path: str) -> dict[str, Any]:
    for backoff in (*_RETRY_BACKOFF_S, None):
        try:
            resp = requests.get(f"{BASE_URL}/{path}.json", params={"limit": 100}, timeout=_TIMEOUT_S)
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
            if backoff is None:
                raise
            _sleep(backoff)
            continue
        if resp.status_code not in _RETRYABLE_STATUS or backoff is None:
            break
        _sleep(backoff)
    resp.raise_for_status()
    return resp.json()


def fetch_classification(year: int, round_num: int, *, sprint: bool = False) -> list[dict]:
    """Empty until Jolpica publishes the session's results (usually within hours of the flag)."""
    endpoint, key = ("sprint", "SprintResults") if sprint else ("results", "Results")
    races = _get(f"{year}/{round_num}/{endpoint}")["MRData"]["RaceTable"]["Races"]
    return races[0].get(key, []) if races else []
