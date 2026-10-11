import os

import pytest

# src.config reads DATABASE_URL at import time. Forced (not setdefault) to a port that refuses
# instantly, so a stray real connection can never reach Neon or another local Postgres.
os.environ["DATABASE_URL"] = "postgresql://test:test@127.0.0.1:1/test"

import src.utils.openf1_client as openf1_client  # noqa: E402, needs DATABASE_URL set first


@pytest.fixture(autouse=True)
def _isolated_openf1_client(monkeypatch):
    """The client paces and budgets requests with module state; give every test a fresh,
    unlimited client that never really sleeps."""
    monkeypatch.setattr(openf1_client, "_sleep", lambda seconds: None)
    monkeypatch.setattr(openf1_client, "_last_request_at", None)
    monkeypatch.setattr(openf1_client, "_remaining_requests", None)
