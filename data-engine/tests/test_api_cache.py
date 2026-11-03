import pytest

import src.utils.api_cache as api_cache
from tests.support.fake_kv_api import FakeResponse, install_fake_kv_api


@pytest.fixture
def kv(monkeypatch):
    return install_fake_kv_api(monkeypatch)


def test_does_nothing_when_cloudflare_is_not_configured(kv, monkeypatch):
    monkeypatch.delenv("CLOUDFLARE_API_TOKEN")

    api_cache.bump_data_version()

    assert kv.calls == 0


def test_a_bump_gives_the_api_a_new_data_version(kv):
    api_cache.bump_data_version()
    first = kv.state()["version"]

    api_cache.bump_data_version()

    assert kv.state()["version"] != first


def test_a_bump_keeps_serving_stale_while_over_budget(kv):
    api_cache.set_serve_stale(True)

    api_cache.bump_data_version()

    assert kv.state()["serveStale"] is True


def test_an_unreachable_cloudflare_never_fails_the_job(kv, capsys):
    kv.fail = True

    api_cache.bump_data_version()

    assert '"status": "failed"' in capsys.readouterr().out


def test_a_failed_read_never_overwrites_the_stored_state(kv, monkeypatch):
    api_cache.set_serve_stale(True)
    monkeypatch.setattr(api_cache.requests, "get", lambda url, headers=None, timeout=None: FakeResponse(500))

    api_cache.bump_data_version()

    assert kv.state() == {"serveStale": True}
