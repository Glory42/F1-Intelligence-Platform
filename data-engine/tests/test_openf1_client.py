from datetime import datetime, timezone

import pytest
import requests

import src.utils.openf1_client as openf1_client
from src.utils.openf1_client import fetch_session_data, find_weekend_session_key


def fetch_race_control(key):
    return fetch_session_data("race_control", key)


def fetch_overtakes(key):
    return fetch_session_data("overtakes", key)


def fetch_team_radio(key):
    return fetch_session_data("team_radio", key)


class _FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.exceptions.HTTPError(f"{self.status_code} error")

    def json(self):
        return self._payload


def _weekend(meeting_key, race_day, *others):
    sessions = [{"session_key": meeting_key * 10, "meeting_key": meeting_key, "session_name": "Race",
                 "date_start": f"{race_day}T13:00:00+00:00"}]
    for offset, (name, extra) in enumerate(others, start=1):
        sessions.append({"session_key": meeting_key * 10 + offset, "meeting_key": meeting_key,
                         "session_name": name, "date_start": f"{race_day}T09:00:00+00:00", **extra})
    return sessions


class TestFindWeekendSessionKey:
    def test_finds_a_session_in_the_weekend_of_the_race_date(self, monkeypatch):
        sessions = _weekend(1, "2026-10-04", ("Qualifying", {})) + _weekend(2, "2026-10-11", ("Qualifying", {}))
        monkeypatch.setattr(openf1_client.requests, "get", lambda *a, **k: _FakeResponse(sessions))

        assert find_weekend_session_key(2026, "2026-10-11", ("Qualifying",)) == 21

    def test_accepts_any_of_the_given_names(self, monkeypatch):
        sessions = _weekend(1, "2023-07-30", ("Sprint Shootout", {}))
        monkeypatch.setattr(openf1_client.requests, "get", lambda *a, **k: _FakeResponse(sessions))

        assert find_weekend_session_key(2023, "2023-07-30", ("Sprint Qualifying", "Sprint Shootout")) == 11

    def test_skips_cancelled_sessions(self, monkeypatch):
        sessions = _weekend(1, "2026-10-04", ("Qualifying", {"is_cancelled": True}))
        monkeypatch.setattr(openf1_client.requests, "get", lambda *a, **k: _FakeResponse(sessions))

        with pytest.raises(ValueError, match="no Qualifying session"):
            find_weekend_session_key(2026, "2026-10-04", ("Qualifying",))

    def test_no_race_near_the_date_raises(self, monkeypatch):
        monkeypatch.setattr(openf1_client.requests, "get", lambda *a, **k: _FakeResponse(_weekend(1, "2026-10-04")))

        with pytest.raises(ValueError, match="No OpenF1 race weekend"):
            find_weekend_session_key(2026, "2026-10-25", ("Race",))

    def test_queries_the_whole_year_once(self, monkeypatch):
        calls = []

        def fake_get(url, params, timeout):
            calls.append((url, params))
            return _FakeResponse(_weekend(1, "2026-10-04"))

        monkeypatch.setattr(openf1_client.requests, "get", fake_get)

        find_weekend_session_key(2026, "2026-10-04", ("Race",))
        assert calls == [(f"{openf1_client.BASE_URL}/sessions", {"year": 2026})]


class TestFetchSessionData:
    def test_filters_the_endpoint_by_session_key(self, monkeypatch):
        calls = []
        monkeypatch.setattr(openf1_client.requests, "get",
                            lambda url, params, timeout: calls.append((url, params)) or _FakeResponse([{"x": 1}]))

        assert fetch_session_data("session_result", 11731) == [{"x": 1}]
        assert calls == [(f"{openf1_client.BASE_URL}/session_result", {"session_key": 11731})]


class TestEmptyResults:
    @pytest.mark.parametrize("endpoint", ["race_control", "overtakes", "team_radio"])
    def test_a_404_is_an_empty_list(self, monkeypatch, endpoint):
        # A session with zero radio clips (common: F1 doesn't release radio for every session)
        # 404s instead of returning 200 + [].
        monkeypatch.setattr(
            openf1_client.requests, "get",
            lambda *a, **k: _FakeResponse({"detail": "No results found."}, status_code=404)
        )

        assert fetch_session_data(endpoint, 9636) == []


class _ScriptedGet:
    """Returns each scripted response in turn; records how many HTTP calls were made."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = 0

    def __call__(self, *args, **kwargs):
        self.calls += 1
        return self._responses.pop(0)


class TestResilience:
    @pytest.fixture(autouse=True)
    def _no_real_waits(self, monkeypatch):
        self.waits = []
        monkeypatch.setattr(openf1_client, "_sleep", self.waits.append)

    def test_retries_a_rate_limited_request_until_it_succeeds(self, monkeypatch):
        get = _ScriptedGet([_FakeResponse({}, 429), _FakeResponse({}, 429), _FakeResponse([{"message": "GREEN"}])])
        monkeypatch.setattr(openf1_client.requests, "get", get)

        assert fetch_race_control(9590) == [{"message": "GREEN"}]
        assert get.calls == 3

    def test_gives_up_after_three_attempts_on_a_persistent_server_error(self, monkeypatch):
        get = _ScriptedGet([_FakeResponse({}, 503)] * 5)
        monkeypatch.setattr(openf1_client.requests, "get", get)

        with pytest.raises(requests.exceptions.HTTPError):
            fetch_race_control(9590)
        assert get.calls == 3

    def test_retries_a_dropped_connection(self, monkeypatch):
        outcomes = [requests.exceptions.ConnectionError("reset"), _FakeResponse([{"message": "GREEN"}])]

        def _get(*args, **kwargs):
            outcome = outcomes.pop(0)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        monkeypatch.setattr(openf1_client.requests, "get", _get)

        assert fetch_race_control(9590) == [{"message": "GREEN"}]

    def test_refuses_requests_beyond_the_cycle_budget_without_calling_openf1(self, monkeypatch):
        get = _ScriptedGet([_FakeResponse([])] * 5)
        monkeypatch.setattr(openf1_client.requests, "get", get)
        openf1_client.reset_request_budget(limit=2)

        fetch_race_control(1)
        fetch_overtakes(1)
        with pytest.raises(openf1_client.OpenF1BudgetExceeded):
            fetch_team_radio(1)
        assert get.calls == 2

    def test_spaces_consecutive_requests_to_stay_under_thirty_per_minute(self, monkeypatch):
        monkeypatch.setattr(openf1_client.requests, "get", _ScriptedGet([_FakeResponse([])] * 2))
        monkeypatch.setattr(openf1_client, "_monotonic", lambda: 100.0)

        fetch_race_control(1)
        fetch_overtakes(1)

        assert self.waits == [2.0]


class TestFetchLapChannels:
    def test_car_data_is_filtered_to_the_lap_window_with_openf1_operator_syntax(self, monkeypatch):
        seen = []
        monkeypatch.setattr(
            openf1_client.requests, "get",
            lambda url, params, timeout: seen.append((url, params)) or _FakeResponse([]),
        )
        start = datetime(2024, 8, 31, 15, 2, 50, 589000, tzinfo=timezone.utc)
        end = datetime(2024, 8, 31, 15, 4, 9, 916000, tzinfo=timezone.utc)

        openf1_client.fetch_lap_samples("car_data", 9586, 4, start, end)

        url, params = seen[0]
        assert url == (
            "https://api.openf1.org/v1/car_data?date%3E%3D2024-08-31T15:02:50.589000%2B00:00"
            "&date%3C%3D2024-08-31T15:04:09.916000%2B00:00"
        )
        assert params == {"session_key": 9586, "driver_number": 4}
