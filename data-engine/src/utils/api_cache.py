"""Tells the API's KV cache (apps/api/src/common/kv-cache.ts) that Neon's data changed. It goes
through Cloudflare's REST API, never Neon, so call it after the job's DB connection is closed."""
import json
import os
import uuid
from typing import Any

import requests

from src.utils.logging_utils import log_job_failure

STATE_KEY = "meta:state"
TIMEOUT_SECONDS = 10


def _config() -> tuple[str, str, str] | None:
    names = ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CF_KV_NAMESPACE_ID")
    values = tuple(os.environ.get(name, "") for name in names)
    return values if all(values) else None  # type: ignore[return-value]


def _update_state(**changes: Any) -> None:
    config = _config()
    if config is None:
        return
    token, account, namespace = config
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/storage/kv/namespaces/{namespace}/values/{STATE_KEY}"
    headers = {"Authorization": f"Bearer {token}"}
    try:
        current = requests.get(url, headers=headers, timeout=TIMEOUT_SECONDS)
        if current.status_code != 404:
            current.raise_for_status()
        state = json.loads(current.text) if current.status_code == 200 else {}
        requests.put(url, data=json.dumps({**state, **changes}), headers=headers, timeout=TIMEOUT_SECONDS).raise_for_status()
    except requests.RequestException as e:
        # The data is already in Neon; the cache just stays on its old version until the next bump.
        log_job_failure("api_cache", e, changes=list(changes))


def bump_data_version() -> None:
    _update_state(version=uuid.uuid4().hex)


def set_serve_stale(on: bool) -> None:
    _update_state(serveStale=on)
