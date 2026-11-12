from datetime import date

import numpy as np
import pytest

from src.jobs import compute_features, compute_sprint_features
from src.utils.conditional_logit import LogitModel
from src.utils.gp_features_v4 import GP_V4_FEATURES, sprint_features
from src.utils.gp_model_v4 import CommittedFit
from tests.support.fake_db import FakeConnection
from tests.support.race_history import quali_row, sample_history

RACE_DAY = date(2026, 4, 1)
# Driver 2 out-qualified driver 1 for the sprint, the reverse of the GP qualifying sheet.
SPRINT_GRID = {3: [quali_row(1, 10, 2, 70500), quali_row(2, 10, 1, 70000), quali_row(3, 20, 3, 71000)]}


def _model() -> LogitModel:
    k = len(GP_V4_FEATURES)
    return LogitModel(GP_V4_FEATURES, np.zeros(k), np.ones(k), np.linspace(0.2, 0.8, k))


def _committed(trained_to: date = date(2026, 3, 20)) -> CommittedFit:
    return CommittedFit(_model(), l2=1.0, trained_to=trained_to)


def _run(monkeypatch, committed: CommittedFit, race=None):
    conn = FakeConnection([race if race is not None else {"race_date": RACE_DAY, "year": 2026}, []])
    upserts: list[tuple] = []
    monkeypatch.setattr(compute_sprint_features, "get_conn", lambda: conn)
    monkeypatch.setattr(compute_sprint_features, "load_committed", lambda: committed)
    monkeypatch.setattr(compute_sprint_features, "load_history",
                        lambda c, since, until: sample_history(sprint_grid=SPRINT_GRID))
    monkeypatch.setattr(compute_features, "upsert",
                        lambda conn, table, rows, conflict, commit=True: upserts.append((table, rows, conflict, commit)))
    compute_sprint_features.run(3)
    return conn, upserts


class TestRun:
    def test_scores_the_sprint_grid_with_the_gp_weights_and_stores_it_like_a_gp(self, monkeypatch):
        conn, upserts = _run(monkeypatch, _committed())

        (features_table, rows, conflict, c1), (winner_table, winner, _, c2) = upserts
        assert (features_table, conflict, len(rows)) == ("driver_sprint_features", ["race_id", "driver_id"], 3)
        assert winner_table == "sprint_predictions"
        assert winner[0]["model_version"] == "sprint-v3"
        assert winner[0]["predicted_winner_id"] == rows[0]["driver_id"]
        expected = _model().probabilities(sprint_features(sample_history(sprint_grid=SPRINT_GRID), 3))
        assert {r["driver_id"]: r["win_probability"] for r in rows} == pytest.approx(expected, abs=1e-5)
        assert set(rows[0]["features"].adapted) == set(GP_V4_FEATURES)
        assert "podium_probability" not in rows[0]
        assert (c1, c2) == (False, False) and conn.commits == 1 and conn.closed is True

    def test_drops_rows_for_drivers_no_longer_on_the_sprint_grid(self, monkeypatch):
        conn, _ = _run(monkeypatch, _committed())

        query, params = conn.cursors[-1].executed[-1]
        assert query.startswith("DELETE FROM driver_sprint_features")
        assert params[0] == 3 and sorted(params[1]) == [1, 2, 3]

    def test_a_sprint_inside_the_committed_fit_is_left_alone(self, monkeypatch, capsys):
        conn, upserts = _run(monkeypatch, _committed(trained_to=RACE_DAY))

        assert upserts == [] and conn.commits == 0
        assert "backfill_all_predictions.py --from 2026" in capsys.readouterr().out

    def test_an_unknown_race_fails(self, monkeypatch):
        monkeypatch.setattr(compute_sprint_features, "get_conn", lambda: FakeConnection([None]))
        monkeypatch.setattr(compute_sprint_features, "load_committed", _committed)

        with pytest.raises(ValueError, match="Race 3 not found"):
            compute_sprint_features.run(3)
