from datetime import date

import numpy as np
import pytest

from src.jobs import compute_features
from src.utils.conditional_logit import LogitModel
from src.utils.gp_features_v4 import GP_V4_FEATURES, gp_features
from src.utils.gp_model_v4 import CommittedFit, predict
from tests.support.fake_db import FakeConnection
from tests.support.race_history import sample_history

RACE_DAY = date(2026, 4, 1)


def _model() -> LogitModel:
    k = len(GP_V4_FEATURES)
    return LogitModel(GP_V4_FEATURES, np.zeros(k), np.ones(k), np.linspace(0.2, 0.8, k))


def _committed(trained_to: date = date(2026, 3, 20)) -> CommittedFit:
    return CommittedFit(_model(), l2=1.0, trained_to=trained_to)


class TestPredictionRows:
    def test_store_each_features_value_and_contribution_with_the_probability_and_rank(self):
        rows = compute_features.prediction_rows(3, predict(sample_history(), 3, _model()))

        assert [r["predicted_position"] for r in rows] == [1, 2, 3, 4]
        row = next(r for r in rows if r["driver_id"] == 3)
        features = row["features"].adapted
        assert set(features) == set(GP_V4_FEATURES)
        assert features["grid"]["value"] == pytest.approx(-np.log(3), abs=1e-5)
        assert row["raw_weighted_score"] == pytest.approx(sum(f["contribution"] for f in features.values()), abs=1e-4)

    def test_the_stored_probability_is_what_the_backtest_scores(self):
        model, history = _model(), sample_history()

        rows = compute_features.prediction_rows(3, predict(history, 3, model))

        expected = model.probabilities(gp_features(history, 3))
        assert {r["driver_id"]: r["win_probability"] for r in rows} == pytest.approx(expected, abs=1e-5)


class _Writes:
    def __init__(self, monkeypatch):
        self.upserts: list[tuple] = []
        monkeypatch.setattr(
            compute_features, "upsert",
            lambda conn, table, rows, conflict, commit=True: self.upserts.append((table, rows, conflict, commit)),
        )


def _run(monkeypatch, committed: CommittedFit, race=None):
    conn = FakeConnection([race if race is not None else {"race_date": RACE_DAY, "year": 2026}, []])
    windows = []
    monkeypatch.setattr(compute_features, "get_conn", lambda: conn)
    monkeypatch.setattr(compute_features, "load_committed", lambda: committed)
    monkeypatch.setattr(
        compute_features, "load_history",
        lambda c, since, until: windows.append((since, until)) or sample_history(),
    )
    writes = _Writes(monkeypatch)
    compute_features.run(3)
    return conn, writes, windows


class TestRun:
    def test_writes_features_probabilities_and_the_winner_in_one_transaction(self, monkeypatch):
        conn, writes, windows = _run(monkeypatch, _committed())

        assert windows == [(date(2023, 1, 1), RACE_DAY)]
        (features_table, rows, conflict, c1), (winner_table, winner, winner_conflict, c2) = writes.upserts
        assert (features_table, conflict, len(rows)) == ("driver_prediction_features", ["race_id", "driver_id"], 4)
        assert sum(r["win_probability"] for r in rows) == pytest.approx(1, abs=1e-4)
        assert winner_table == "race_predictions" and winner_conflict == ["race_id"]
        assert winner[0]["predicted_winner_id"] == rows[0]["driver_id"]
        assert winner[0]["model_version"] == "weighted-v4"
        assert (c1, c2) == (False, False)
        assert conn.commits == 1
        assert conn.closed is True

    def test_drops_rows_for_drivers_no_longer_in_the_field(self, monkeypatch):
        conn, _, _ = _run(monkeypatch, _committed())

        query, params = conn.cursors[-1].executed[-1]
        assert query.startswith("DELETE FROM driver_prediction_features")
        assert params[0] == 3 and sorted(params[1]) == [1, 2, 3, 4]

    def test_a_race_the_committed_weights_were_fitted_on_is_left_alone(self, monkeypatch, capsys):
        conn, writes, windows = _run(monkeypatch, _committed(trained_to=RACE_DAY))

        assert writes.upserts == [] and windows == []
        assert conn.commits == 0
        assert "backfill_all_predictions.py --from 2026" in capsys.readouterr().out

    def test_an_unknown_race_fails(self, monkeypatch):
        monkeypatch.setattr(compute_features, "get_conn", lambda: FakeConnection([None]))
        monkeypatch.setattr(compute_features, "load_committed", _committed)

        with pytest.raises(ValueError, match="Race 3 not found"):
            compute_features.run(3)
