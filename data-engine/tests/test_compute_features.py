from datetime import date, timedelta

import numpy as np
import pytest

from src.jobs import compute_features
from src.utils.conditional_logit import LogitModel
from src.utils.gp_features_v4 import GP_V4_FEATURES
from src.utils.math_utils import softmax
from tests.support.fake_db import FakeConnection
from tests.support.race_history import sample_history


def _model() -> LogitModel:
    k = len(GP_V4_FEATURES)
    return LogitModel(GP_V4_FEATURES, np.zeros(k), np.ones(k), np.linspace(0.2, 0.8, k))


class TestFeatureRows:
    def test_stores_each_features_value_and_contribution(self):
        rows = compute_features.feature_rows(sample_history(), 3, _model())

        assert [r["driver_id"] for r in rows] == [1, 2, 3, 4]
        features = rows[2]["features"].adapted
        assert set(features) == set(GP_V4_FEATURES)
        assert features["grid"]["value"] == pytest.approx(-np.log(3), abs=1e-5)
        assert rows[2]["raw_weighted_score"] == pytest.approx(
            sum(f["contribution"] for f in features.values()), abs=1e-4
        )

    def test_a_plain_softmax_of_the_raw_scores_is_the_models_win_probability(self):
        model = _model()
        history = sample_history()

        rows = compute_features.feature_rows(history, 3, model)

        expected = model.probabilities(compute_features.gp_features(history, 3))
        probs = softmax([r["raw_weighted_score"] for r in rows])
        assert probs == pytest.approx([expected[r["driver_id"]] for r in rows], abs=1e-5)


class TestRun:
    def test_loads_three_seasons_before_the_race_and_writes_one_row_per_driver(self, monkeypatch):
        race_day = date(2026, 4, 1)
        conn = FakeConnection([{"race_date": race_day}])
        windows, written = [], []
        monkeypatch.setattr(compute_features, "get_conn", lambda: conn)
        monkeypatch.setattr(compute_features, "load_model", _model)
        monkeypatch.setattr(
            compute_features, "load_history",
            lambda c, since, until: windows.append((since, until)) or sample_history(),
        )
        monkeypatch.setattr(
            compute_features, "upsert", lambda c, table, rows, conflict: written.append((table, rows, conflict))
        )

        compute_features.run(3)

        assert windows == [(race_day - timedelta(days=compute_features.HISTORY_DAYS), race_day)]
        (table, rows, conflict), = written
        assert table == "driver_prediction_features"
        assert len(rows) == 4
        assert conflict == ["race_id", "driver_id"]
        assert conn.closed is True

    def test_an_unknown_race_fails(self, monkeypatch):
        monkeypatch.setattr(compute_features, "get_conn", lambda: FakeConnection([None]))
        monkeypatch.setattr(compute_features, "load_model", _model)

        with pytest.raises(ValueError, match="Race 9 not found"):
            compute_features.run(9)
