"""Stands in for api.openf1.org at openf1_client._get, the client's one request: tests fake OpenF1 once
instead of patching each job's fetches. Every answer spends the client's real request budget, so budget
behaviour is exercised as it runs."""
from datetime import date, datetime
from typing import Any, Callable, Union
from urllib.parse import unquote

from src.utils import openf1_client

Answer = Union[list[dict], Callable[[dict[str, Any], str], list[dict]]]

WEEKEND_SESSIONS = ("Practice 1", "Practice 2", "Sprint Qualifying", "Sprint", "Qualifying", "Race")


def weekend(race_date: date, names: tuple[str, ...] = WEEKEND_SESSIONS, first_key: int = 9000) -> list[dict]:
    """/sessions for one meeting: each named session keyed first_key, first_key + 1, ... in order."""
    return [
        {"session_key": first_key + i, "session_name": name, "meeting_key": 1,
         "date_start": f"{race_date.isoformat()}T13:00:00+00:00", "is_cancelled": False}
        for i, name in enumerate(names)
    ]


def window_of(operator_filters: str) -> tuple[datetime, datetime]:
    """The (start, end) a car_data/location request asked for, decoded from its date filters."""
    lower, upper = unquote(operator_filters.lstrip("?")).split("&")
    return datetime.fromisoformat(lower.split(">=", 1)[1]), datetime.fromisoformat(upper.split("<=", 1)[1])


class FakeOpenF1:
    def __init__(self, monkeypatch, endpoints: dict[str, Answer]):
        self.endpoints = endpoints
        self.requests: list[tuple[str, dict[str, Any]]] = []
        monkeypatch.setattr(openf1_client, "_get", self._get)

    def _get(self, path: str, params: dict[str, Any], operator_filters: str = "") -> list[dict]:
        openf1_client._spend_request()
        self.requests.append((path, dict(params)))
        answer = self.endpoints.get(path, [])
        return answer(params, operator_filters) if callable(answer) else answer

    def paths(self) -> list[str]:
        return [path for path, _ in self.requests]
