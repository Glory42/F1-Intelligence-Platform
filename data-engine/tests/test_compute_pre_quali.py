from datetime import date

import numpy as np
import pytest

from src.jobs import compute_pre_quali
from src.utils.conditional_logit import LogitModel
from src.utils.gp_features_v4 import PRE_QUALI_FEATURES, pre_quali_features
from src.utils.gp_model_v4 import CommittedFit
from tests.support.fake_db import FakeConnection
from tests.support.race_history import sample_history

NEXT_RACE = {"id": 3, "race_date": date(2026, 4, 1), "year": 2026}


def _model() -> LogitModel:
    k = len(PRE_QUALI_FEATURES)
    return LogitModel(PRE_QUALI_FEATURES, np.zeros(k), np.ones(k), np.linspace(0.3, 0.9, k))


def _run(monkeypatch, next_race=NEXT_RACE, trained_to=date(2026, 3, 20)):
    conn = FakeConnection([next_race, []])
    upserts: list[tuple] = []
    monkeypatch.setattr(compute_pre_quali, "get_conn", lambda: conn)
    monkeypatch.setattr(compute_pre_quali, "load_pre_quali", lambda: CommittedFit(_model(), 1.0, trained_to))
    monkeypatch.setattr(compute_pre_quali, "load_history", lambda c, since, until: sample_history())
    monkeypatch.setattr(compute_pre_quali, "upsert",
                        lambda conn, table, rows, conflict, commit=True: upserts.append((table, rows, conflict, commit)))
    compute_pre_quali.run(2)
    return conn, upserts


class TestRun:
    def test_forecasts_the_next_race_over_the_lineup_just_raced(self, monkeypatch):
        conn, upserts = _run(monkeypatch)

        [(table, rows, conflict, commit)] = upserts
        assert (table, conflict, commit) == ("pre_quali_predictions", ["race_id", "driver_id"], False)
        assert {r["race_id"] for r in rows} == {3}
        assert {r["model_version"] for r in rows} == {"pre-quali-v1"}
        expected = _model().probabilities(pre_quali_features(sample_history(), 3))
        assert {r["driver_id"]: r["win_probability"] for r in rows} == pytest.approx(expected, abs=1e-5)
        assert set(rows[0]["features"].adapted) == set(PRE_QUALI_FEATURES)
        assert [r["predicted_position"] for r in rows] == [1, 2, 3]
        assert conn.commits == 1 and conn.closed is True

    def test_drops_drivers_no_longer_in_the_lineup(self, monkeypatch):
        conn, _ = _run(monkeypatch)

        query, params = conn.cursors[-1].executed[-1]
        assert query.startswith("DELETE FROM pre_quali_predictions")
        assert params[0] == 3 and sorted(params[1]) == [1, 2, 3]

    def test_the_season_finale_has_nothing_after_it(self, monkeypatch, capsys):
        conn, upserts = _run(monkeypatch, next_race=None)

        assert upserts == [] and conn.commits == 0
        assert "season's last race" in capsys.readouterr().out

    def test_a_race_inside_the_committed_fit_is_left_alone(self, monkeypatch, capsys):
        _, upserts = _run(monkeypatch, trained_to=date(2026, 4, 1))

        assert upserts == []
        assert "backfill_all_predictions.py --from 2026" in capsys.readouterr().out
