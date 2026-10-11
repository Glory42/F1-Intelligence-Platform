import src.utils.upsert as upsert_module
from src.utils.upsert import upsert
from tests.support.fake_db import FakeConnection

# execute_batch renders SQL via psycopg2's C extension, which requires a real
# connection even just to quote identifiers: so, like test_ingest_runner.py's
# headshot-backfill test, we monkeypatch execute_batch itself and assert on the
# params it receives rather than trying to render the query text.


def test_upsert_sends_one_param_row_per_input_row_in_column_order(monkeypatch):
    batch_calls = []
    monkeypatch.setattr(
        upsert_module,
        "execute_batch",
        lambda cur, query, params, page_size=200: batch_calls.append((params, page_size)),
    )
    conn = FakeConnection([])

    rows = [
        {"race_id": 1, "driver_id": 10, "score": 0.5},
        {"race_id": 1, "driver_id": 11, "score": 0.7},
    ]

    upsert(conn, "driver_prediction_features", rows, ["race_id", "driver_id"])

    assert len(batch_calls) == 1
    params, page_size = batch_calls[0]
    assert params == [[1, 10, 0.5], [1, 11, 0.7]]
    assert page_size == 200
    assert conn.commits == 1
    assert conn.closed is False


def test_upsert_noops_on_empty_rows(monkeypatch):
    batch_calls = []
    monkeypatch.setattr(
        upsert_module, "execute_batch", lambda cur, query, params, page_size=200: batch_calls.append(params)
    )
    conn = FakeConnection([])

    upsert(conn, "driver_prediction_features", [], ["race_id", "driver_id"])

    assert batch_calls == []
    assert conn.commits == 0
    assert conn.cursors == []
