import json
from pathlib import Path

import pytest
import requests

import src.utils.jolpica_client as jolpica_client
from src.utils.jolpica_client import fetch_classification

_RESULTS = json.loads((Path(__file__).resolve().parent / "fixtures" / "jolpica" / "results_2026_bahrain.json").read_text())


class _FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.exceptions.HTTPError(f"{self.status_code} error")

    def json(self):
        return self._payload


def _race_table(races):
    return {"MRData": {"RaceTable": {"Races": races}}}


class TestFetchClassification:
    def test_returns_the_race_results(self, monkeypatch):
        calls = []
        monkeypatch.setattr(jolpica_client.requests, "get", lambda url, params, timeout: calls.append(url) or
                            _FakeResponse(_race_table([{"round": "16", "Results": _RESULTS}])))

        assert fetch_classification(2026, 16) == _RESULTS
        assert calls == [f"{jolpica_client.BASE_URL}/2026/16/results.json"]

    def test_reads_sprint_results_from_the_sprint_endpoint(self, monkeypatch):
        calls = []
        monkeypatch.setattr(jolpica_client.requests, "get", lambda url, params, timeout: calls.append(url) or
                            _FakeResponse(_race_table([{"round": "17", "SprintResults": _RESULTS}])))

        assert fetch_classification(2026, 17, sprint=True) == _RESULTS
        assert calls == [f"{jolpica_client.BASE_URL}/2026/17/sprint.json"]

    def test_not_yet_published_is_empty(self, monkeypatch):
        monkeypatch.setattr(jolpica_client.requests, "get", lambda *a, **k: _FakeResponse(_race_table([])))

        assert fetch_classification(2026, 19) == []

    def test_retries_a_rate_limited_request(self, monkeypatch):
        responses = [_FakeResponse({}, status_code=429), _FakeResponse(_race_table([{"Results": _RESULTS}]))]
        monkeypatch.setattr(jolpica_client.requests, "get", lambda *a, **k: responses.pop(0))

        assert fetch_classification(2026, 16) == _RESULTS

    def test_gives_up_after_the_last_attempt(self, monkeypatch):
        monkeypatch.setattr(jolpica_client.requests, "get", lambda *a, **k: _FakeResponse({}, status_code=503))

        with pytest.raises(requests.exceptions.HTTPError):
            fetch_classification(2026, 16)
