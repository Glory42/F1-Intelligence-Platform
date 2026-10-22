import json

import numpy as np
import pytest

from src.utils.conditional_logit import LogitModel
from src.utils.gp_features_v4 import GP_V4_FEATURES
from src.utils.gp_model_v4 import importance_percentages, load_model, save_model, training_set
from tests.support.race_history import sample_history


def _model(coef) -> LogitModel:
    k = len(GP_V4_FEATURES)
    return LogitModel(GP_V4_FEATURES, np.zeros(k), np.ones(k), np.array(coef, dtype=float))


class TestSaveAndLoad:
    def test_round_trips_the_fitted_weights(self, tmp_path):
        model = _model(np.linspace(0.1, 0.7, len(GP_V4_FEATURES)))
        path = tmp_path / "gp_v4.json"

        save_model(model, {"from_year": 2010, "to_date": "2026-10-11", "races": 346}, l2=1.0, path=path)
        loaded = load_model(path)

        assert loaded.features == GP_V4_FEATURES
        assert loaded.coef == pytest.approx(model.coef)
        assert json.loads(path.read_text())["model_version"] == "weighted-v4"

    def test_refuses_a_fit_made_for_a_different_feature_list(self, tmp_path):
        path = tmp_path / "gp_v4.json"
        save_model(_model(np.ones(len(GP_V4_FEATURES))), {}, l2=1.0, path=path)
        payload = json.loads(path.read_text())
        payload["features"] = payload["features"][:-1]
        path.write_text(json.dumps(payload))

        with pytest.raises(ValueError, match="refit it"):
            load_model(path)


class TestImportancePercentages:
    def test_shares_of_absolute_weight_add_up_to_exactly_100(self):
        pct = importance_percentages(_model([1, 1, 1, 0, 0, 0, 0]))

        assert sum(pct.values()) == 100
        assert sorted(pct.values()) == [0, 0, 0, 0, 33, 33, 34]

    def test_a_negative_weight_still_counts_by_size(self):
        pct = importance_percentages(_model([-3, 1, 0, 0, 0, 0, 0]))

        assert pct[GP_V4_FEATURES[0]] == 75


class TestTrainingSet:
    def test_one_matrix_per_completed_race_with_its_winner_row(self):
        races = training_set(sample_history())

        assert len(races) == 2
        x, winner = races[0]
        assert x.shape == (3, len(GP_V4_FEATURES))
        assert winner == 0  # driver 1 won race 1 and is first on its sheet

    def test_stops_before_the_given_date(self):
        h = sample_history()

        assert len(training_set(h, before=h.races[2]["race_date"])) == 1
