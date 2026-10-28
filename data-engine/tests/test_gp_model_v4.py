import json
from datetime import date

import numpy as np
import pytest

from src.utils.conditional_logit import LogitModel
from src.utils.gp_features_v4 import GP_V4_FEATURES, gp_features
from src.utils.gp_model_v4 import (
    fit, history_start, importance_percentages, load_committed, predict, save_model, training_races,
)
from tests.support.race_history import quali_row, race_row, result_row, sample_history


def _model(coef) -> LogitModel:
    k = len(GP_V4_FEATURES)
    return LogitModel(GP_V4_FEATURES, np.zeros(k), np.ones(k), np.array(coef, dtype=float))


def _three_race_history():
    """sample_history with race 3 run and won by driver 3, so a fit can include or exclude it."""
    h = sample_history()
    h.races[3] = race_row(3, date(2026, 4, 1), overtake_rate=0.2)
    h.results[3] = [result_row(3, 20, 1), result_row(1, 10, 2), result_row(2, 10, 3)]
    h.races[4] = race_row(4, date(2026, 4, 20), status="qualifying_done")
    h.quali[4] = [quali_row(1, 10, 1, 80000), quali_row(2, 10, 2, 80100), quali_row(3, 20, 3, 80200)]
    return h


class TestSaveAndLoad:
    def test_round_trips_the_weights_l2_and_the_last_race_fitted(self, tmp_path):
        model = _model(np.linspace(0.1, 0.7, len(GP_V4_FEATURES)))
        path = tmp_path / "gp_v4.json"

        save_model(model, {"from_year": 2010, "to_date": "2026-10-11", "races": 346}, l2=0.5, path=path)
        committed = load_committed(path)

        assert committed.model.features == GP_V4_FEATURES
        assert committed.model.coef == pytest.approx(model.coef)
        assert committed.l2 == 0.5
        assert committed.trained_to == date(2026, 10, 11)

    def test_a_race_on_or_before_the_last_fitted_race_is_in_sample(self, tmp_path):
        path = tmp_path / "gp_v4.json"
        save_model(_model(np.ones(len(GP_V4_FEATURES))), {"to_date": "2026-10-11"}, l2=1.0, path=path)
        committed = load_committed(path)

        assert committed.is_in_sample(date(2026, 10, 11))
        assert not committed.is_in_sample(date(2026, 10, 25))

    def test_refuses_a_fit_made_for_a_different_feature_list(self, tmp_path):
        path = tmp_path / "gp_v4.json"
        save_model(_model(np.ones(len(GP_V4_FEATURES))), {"to_date": "2026-10-11"}, l2=1.0, path=path)
        payload = json.loads(path.read_text())
        payload["features"] = payload["features"][:-1]
        path.write_text(json.dumps(payload))

        with pytest.raises(ValueError, match="refit it"):
            load_committed(path)

    def test_refuses_a_fit_for_another_model_version(self, tmp_path):
        path = tmp_path / "gp_v4.json"
        save_model(_model(np.ones(len(GP_V4_FEATURES))), {"to_date": "2026-10-11"}, l2=1.0, path=path)
        payload = json.loads(path.read_text())
        payload["model_version"] = "weighted-v5"
        path.write_text(json.dumps(payload))

        with pytest.raises(ValueError, match="weighted-v5"):
            load_committed(path)


class TestImportancePercentages:
    def test_shares_of_absolute_weight_add_up_to_exactly_100(self):
        pct = importance_percentages(_model([1, 1, 1, 0, 0, 0, 0]))

        assert sum(pct.values()) == 100
        assert sorted(pct.values()) == [0, 0, 0, 0, 33, 33, 34]

    def test_a_negative_weight_still_counts_by_size(self):
        pct = importance_percentages(_model([-3, 1, 0, 0, 0, 0, 0]))

        assert pct[GP_V4_FEATURES[0]] == 75


class TestTrainingRaces:
    def test_one_field_per_completed_race_with_its_winner_oldest_first(self):
        races = training_races(sample_history())

        assert [t.race_id for t in races] == [1, 2]
        assert races[0].winner == 1
        assert races[0].matrix(GP_V4_FEATURES).shape == (3, len(GP_V4_FEATURES))

    def test_skips_seasons_before_from_year(self):
        assert training_races(sample_history(), from_year=2027) == []


class TestFit:
    def test_never_sees_a_race_on_or_after_before(self):
        h = _three_race_history()
        training = training_races(h)

        cut = fit(training, before=h.races[3]["race_date"])
        only_earlier = fit([t for t in training if t.race_id in (1, 2)])

        assert cut.coef == pytest.approx(only_earlier.coef)
        assert not np.allclose(cut.coef, fit(training).coef)

    def test_nothing_to_fit_on_fails(self):
        with pytest.raises(ValueError, match="No completed GPs"):
            fit(training_races(sample_history()), before=date(2000, 1, 1))


class TestPredict:
    def test_ranks_the_field_by_the_models_probability(self):
        model = _model(np.linspace(0.2, 0.8, len(GP_V4_FEATURES)))
        history = sample_history()

        predictions = predict(history, 3, model)

        expected = model.probabilities(gp_features(history, 3))
        assert {p.driver_id: p.probability for p in predictions} == pytest.approx(expected)
        assert [p.position for p in predictions] == [1, 2, 3, 4]
        assert [p.probability for p in predictions] == sorted(expected.values(), reverse=True)

    def test_each_drivers_score_is_its_summed_contributions(self):
        predictions = predict(sample_history(), 3, _model(np.linspace(0.2, 0.8, len(GP_V4_FEATURES))))

        p = next(p for p in predictions if p.driver_id == 3)
        assert set(p.values) == set(GP_V4_FEATURES)
        assert p.values["grid"] == pytest.approx(-np.log(3))
        assert p.score == pytest.approx(sum(p.contributions.values()))


def test_history_starts_three_seasons_before_the_first_predicted_year():
    assert history_start(2010) == date(2007, 1, 1)
