import pytest

import src.utils.prediction_runner as prediction_runner
from src.utils.prediction_runner import run_prediction_job
from tests.support.fake_db import FakeConnection

# rank_by_probability itself is covered by test_prediction_ranking.py: this file
# covers run_prediction_job, the DB-touching orchestration around it.


class TestRunPredictionJob:
    def _config(self, **overrides):
        defaults = dict(
            job_name="test_job",
            feature_table="driver_prediction_features",
            prediction_table="race_predictions",
            model_version="weighted-v4",
            not_found_error="no features",
            winner_label="predicted winner",
            temperature=1.0,
        )
        defaults.update(overrides)
        return defaults

    def test_happy_path_ranks_updates_and_inserts_prediction(self, monkeypatch):
        feature_rows = [
            {"driver_id": 1, "raw_weighted_score": 0.4},
            {"driver_id": 2, "raw_weighted_score": 0.9},
        ]
        conn = FakeConnection([feature_rows])
        monkeypatch.setattr(prediction_runner, "get_conn", lambda: conn)

        batch_calls = []
        monkeypatch.setattr(
            prediction_runner,
            "execute_batch",
            lambda cur, query, params, page_size=100: batch_calls.append(params),
        )

        run_prediction_job(race_id=7, **self._config())

        assert len(batch_calls) == 1
        by_driver = {row[3]: row for row in batch_calls[0]}
        assert by_driver[2][1] == 1  # higher raw score -> position 1
        assert by_driver[1][1] == 2

        insert_query, insert_params = conn.cursors[-1].executed[-1]
        assert insert_params[0] == 7
        assert insert_params[1] == 2  # predicted_winner_id
        assert insert_params[3] == "weighted-v4"
        assert conn.commits == 1
        assert conn.closed is True

    @pytest.mark.parametrize("temperature, p_top", [(1.0, 0.62246), (0.3, 0.84113)])
    def test_the_jobs_temperature_scales_the_raw_scores(self, monkeypatch, temperature, p_top):
        conn = FakeConnection([[{"driver_id": 1, "raw_weighted_score": 0.4}, {"driver_id": 2, "raw_weighted_score": 0.9}]])
        monkeypatch.setattr(prediction_runner, "get_conn", lambda: conn)
        batch_calls = []
        monkeypatch.setattr(
            prediction_runner, "execute_batch", lambda cur, query, params, page_size=100: batch_calls.append(params)
        )

        run_prediction_job(race_id=7, **self._config(temperature=temperature))

        by_driver = {row[3]: row for row in batch_calls[0]}
        assert by_driver[2][0] == p_top

    def test_raises_when_no_feature_rows(self, monkeypatch):
        conn = FakeConnection([[]])
        monkeypatch.setattr(prediction_runner, "get_conn", lambda: conn)

        with pytest.raises(ValueError, match="no features"):
            run_prediction_job(race_id=7, **self._config())

        assert conn.closed is True

    def test_conn_closed_even_when_update_fails(self, monkeypatch):
        feature_rows = [{"driver_id": 1, "raw_weighted_score": 0.4}]
        conn = FakeConnection([feature_rows])
        monkeypatch.setattr(prediction_runner, "get_conn", lambda: conn)

        def _raise(cur, query, params, page_size=100):
            raise RuntimeError("db exploded")

        monkeypatch.setattr(prediction_runner, "execute_batch", _raise)

        with pytest.raises(RuntimeError, match="db exploded"):
            run_prediction_job(race_id=7, **self._config())

        assert conn.closed is True
        assert conn.commits == 0
