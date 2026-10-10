from datetime import datetime, timezone

import pytest
import requests

import src.utils.openf1_client as openf1_client
from src.utils.openf1_client import fetch_overtakes, fetch_race_control, fetch_team_radio, get_session_key


class _FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.exceptions.HTTPError(f"{self.status_code} error")

    def json(self):
        return self._payload


class TestGetSessionKey:
    def test_matches_session_by_race_date(self, monkeypatch):
        sessions = [
            {"session_key": 9515, "date_start": "2024-05-19T13:00:00+00:00"},
            {"session_key": 9590, "date_start": "2024-09-01T13:00:00+00:00"},
        ]
        monkeypatch.setattr(openf1_client.requests, "get", lambda *a, **k: _FakeResponse(sessions))

        assert get_session_key(2024, "2024-09-01") == 9590

    def test_matches_across_a_one_day_utc_drift(self, monkeypatch):
        # Las Vegas races at night local time, so OpenF1's UTC date_start lands one
        # calendar day after our (local-date) race_date.
        sessions = [{"session_key": 9189, "date_start": "2023-11-19T06:00:00+00:00"}]
        monkeypatch.setattr(openf1_client.requests, "get", lambda *a, **k: _FakeResponse(sessions))

        assert get_session_key(2023, "2023-11-18") == 9189

    def test_no_matching_session_raises(self, monkeypatch):
        sessions = [{"session_key": 9515, "date_start": "2024-05-19T13:00:00+00:00"}]
        monkeypatch.setattr(openf1_client.requests, "get", lambda *a, **k: _FakeResponse(sessions))

        with pytest.raises(ValueError, match="No OpenF1 Race session found"):
            get_session_key(2024, "2024-09-01")

    def test_pre_coverage_year_raises_clean_error(self, monkeypatch):
        # OpenF1 has no data before 2023 — confirmed live to return 404 (not 200 + []) for
        # any query matching zero rows, on every endpoint, not just this pre-coverage case.
        monkeypatch.setattr(
            openf1_client.requests, "get",
            lambda *a, **k: _FakeResponse({"detail": "No results found."}, status_code=404)
        )

        with pytest.raises(ValueError, match="no session data"):
            get_session_key(2021, "2021-03-28")

    def test_accepts_a_full_datetime_for_a_timestamptz_column_like_sprint_date(self, monkeypatch):
        # races.sprint_date is a TIMESTAMPTZ, so psycopg2 hands back a datetime (not a
        # bare date like races.race_date) — must reduce to a date before comparing.
        sessions = [{"session_key": 9591, "date_start": "2024-08-31T15:00:00+00:00"}]
        monkeypatch.setattr(openf1_client.requests, "get", lambda *a, **k: _FakeResponse(sessions))

        target = datetime(2024, 8, 31, 15, 0, tzinfo=timezone.utc)
        assert get_session_key(2024, target, session_name="Sprint") == 9591

    def test_session_name_is_forwarded_to_the_sessions_query(self, monkeypatch):
        captured = {}

        def fake_get(url, params, timeout):
            captured["params"] = params
            return _FakeResponse([{"session_key": 1, "date_start": "2024-09-01T13:00:00+00:00"}])

        monkeypatch.setattr(openf1_client.requests, "get", fake_get)

        get_session_key(2024, "2024-09-01", session_name="Sprint")

        assert captured["params"]["session_name"] == "Sprint"

    def test_no_matching_sprint_session_error_names_the_session(self, monkeypatch):
        sessions = [{"session_key": 9515, "date_start": "2024-05-19T13:00:00+00:00"}]
        monkeypatch.setattr(openf1_client.requests, "get", lambda *a, **k: _FakeResponse(sessions))

        with pytest.raises(ValueError, match="No OpenF1 Sprint session found"):
            get_session_key(2024, "2024-09-01", session_name="Sprint")


class TestFetchRaceControl:
    def test_returns_parsed_json(self, monkeypatch):
        messages = [{"category": "Flag", "message": "GREEN LIGHT - PIT EXIT OPEN"}]
        monkeypatch.setattr(openf1_client.requests, "get", lambda *a, **k: _FakeResponse(messages))

        assert fetch_race_control(9636) == messages

    def test_returns_empty_list_on_404(self, monkeypatch):
        monkeypatch.setattr(
            openf1_client.requests, "get",
            lambda *a, **k: _FakeResponse({"detail": "No results found."}, status_code=404)
        )

        assert fetch_race_control(9636) == []


class TestFetchOvertakes:
    def test_returns_parsed_json(self, monkeypatch):
        overtakes = [{"overtaking_driver_number": 63, "overtaken_driver_number": 4, "position": 1}]
        monkeypatch.setattr(openf1_client.requests, "get", lambda *a, **k: _FakeResponse(overtakes))

        assert fetch_overtakes(9636) == overtakes

    def test_returns_empty_list_on_404(self, monkeypatch):
        monkeypatch.setattr(
            openf1_client.requests, "get",
            lambda *a, **k: _FakeResponse({"detail": "No results found."}, status_code=404)
        )

        assert fetch_overtakes(9636) == []


class TestFetchTeamRadio:
    def test_returns_parsed_json(self, monkeypatch):
        clips = [{"driver_number": 4, "recording_url": "https://example.com/clip.mp3"}]
        monkeypatch.setattr(openf1_client.requests, "get", lambda *a, **k: _FakeResponse(clips))

        assert fetch_team_radio(9636) == clips

    def test_returns_empty_list_on_404(self, monkeypatch):
        # The real bug this guards against: a session with zero radio clips (common — F1
        # doesn't release radio for every session) 404s instead of returning 200 + [].
        monkeypatch.setattr(
            openf1_client.requests, "get",
            lambda *a, **k: _FakeResponse({"detail": "No results found."}, status_code=404)
        )

        assert fetch_team_radio(9636) == []


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


class TestFetchStintsAndPits:
    def test_stints_and_pits_are_queried_by_session_key(self, monkeypatch):
        seen = []
        monkeypatch.setattr(
            openf1_client.requests, "get",
            lambda url, params, timeout: seen.append((url.rsplit("/", 1)[-1], params)) or _FakeResponse([]),
        )

        openf1_client.fetch_stints(9590)
        openf1_client.fetch_pit_stops(9590)

        assert seen == [("stints", {"session_key": 9590}), ("pit", {"session_key": 9590})]


class TestFetchLapChannels:
    def test_car_data_is_filtered_to_the_lap_window_with_openf1_operator_syntax(self, monkeypatch):
        seen = []
        monkeypatch.setattr(
            openf1_client.requests, "get",
            lambda url, params, timeout: seen.append((url, params)) or _FakeResponse([]),
        )
        start = datetime(2024, 8, 31, 15, 2, 50, 589000, tzinfo=timezone.utc)
        end = datetime(2024, 8, 31, 15, 4, 9, 916000, tzinfo=timezone.utc)

        openf1_client.fetch_car_data(9586, 4, start, end)

        url, params = seen[0]
        assert url == (
            "https://api.openf1.org/v1/car_data?date%3E%3D2024-08-31T15:02:50.589000%2B00:00"
            "&date%3C%3D2024-08-31T15:04:09.916000%2B00:00"
        )
        assert params == {"session_key": 9586, "driver_number": 4}
