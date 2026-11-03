"""Cloudflare's KV REST values endpoint, in memory: what src.utils.api_cache talks to."""
import json

import requests

import src.utils.api_cache as api_cache

ENV = {"CLOUDFLARE_API_TOKEN": "token", "CLOUDFLARE_ACCOUNT_ID": "acc", "CF_KV_NAMESPACE_ID": "ns"}


class FakeResponse:
    def __init__(self, status_code: int, text: str = ""):
        self.status_code = status_code
        self.text = text

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code} error")


class FakeKvApi:
    def __init__(self):
        self.values: dict[str, str] = {}
        self.fail = False
        self.calls = 0

    def get(self, url, headers=None, timeout=None):
        self.calls += 1
        if self.fail:
            raise requests.ConnectionError("Cloudflare unreachable")
        return FakeResponse(200, self.values[url]) if url in self.values else FakeResponse(404)

    def put(self, url, data=None, headers=None, timeout=None):
        self.calls += 1
        if self.fail:
            raise requests.ConnectionError("Cloudflare unreachable")
        self.values[url] = data
        return FakeResponse(200)

    def state(self) -> dict:
        return json.loads(next(iter(self.values.values()))) if self.values else {}


def install_fake_kv_api(monkeypatch) -> FakeKvApi:
    fake = FakeKvApi()
    monkeypatch.setattr(api_cache.requests, "get", fake.get)
    monkeypatch.setattr(api_cache.requests, "put", fake.put)
    for name, value in ENV.items():
        monkeypatch.setenv(name, value)
    return fake
