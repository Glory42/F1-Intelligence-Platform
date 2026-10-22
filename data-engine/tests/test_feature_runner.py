"""Covers the sprint feature job end to end against a fake DB: compute_sprint_features reads a scripted
race and writes one row per driver through feature_runner (weighted-v4, the GP model, has its own job).
Reads are routed by a marker in their SQL (they are independent, so their order is the runner's
business); upsert's execute_batch is patched (it needs a real connection to render SQL) and the written
rows are read back from its params. The expected scores are the rows sprint-v2 wrote before it became a
feature_runner spec: a refactor must not move a single one."""
from datetime import date

import pytest
from psycopg2 import sql

import src.utils.upsert as upsert_module
from src.utils import feature_runner
from src.utils.feature_manifest import SPRINT_FEATURES
from src.utils.feature_runner import FeatureJobSpec, ModelScores

RACE_DAY = date(2026, 5, 3)


class _RoutedCursor:
    def __init__(self, routes: dict[str, object], log: list[str]):
        self._routes, self._log, self._rows = routes, log, []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, query, params=None):
        marker = next((m for m in self._routes if m in str(query)), None)
        if marker is None:
            raise AssertionError(f"unscripted query: {query}")
        self._log.append(marker)
        rows = self._routes[marker]
        self._rows = [rows] if isinstance(rows, dict) else list(rows)

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)


class _RoutedConnection:
    def __init__(self, routes: dict[str, object]):
        self.routes, self.queries, self.closed, self.commits = routes, [], False, 0

    def cursor(self):
        return _RoutedCursor(self.routes, self.queries)

    def commit(self):
        self.commits += 1

    def close(self):
        self.closed = True


def _race_agg(driver_id, team_id, races, wins, points, gain, dnf_count):
    return {
        "driver_id": driver_id, "team_id": team_id, "races_entered": races, "wins": wins, "total_points": points,
        "avg_gain": gain, "dnf_count": dnf_count,
    }


def _sprint_agg(driver_id, races, wins, points):
    return {"driver_id": driver_id, "sprint_races_entered": races, "sprint_wins": wins, "sprint_total_points": points}


def _team_agg(team_id, median_finish, entries, dnf_count):
    return {"team_id": team_id, "median_finish": median_finish, "avg_grid": median_finish,
            "total_entries": entries, "dnf_count": dnf_count}


def _season(event_format):
    """Three drivers: two team-mates in a fast car, one in a slower one, at a street circuit."""
    d1, d0 = date(2026, 4, 19), date(2026, 4, 5)
    return {
        "FROM races r JOIN circuits c": {
            "id": 50, "season_id": 3, "race_date": RACE_DAY, "circuit_id": 7,
            "event_format": event_format, "overtake_rate": 0.4, "sc_probability": 0.5, "track_category": "street",
        },
        "g.grid_position FROM": [
            {"driver_id": 1, "grid_position": 1}, {"driver_id": 2, "grid_position": 8},
            {"driver_id": 3, "grid_position": 15},
        ],
        "AS avg_gain": [
            _race_agg(1, 100, 10, 4, 200, 1.5, 1),
            _race_agg(2, 100, 10, 1, 120, -0.5, 2),
            _race_agg(3, 200, 8, 0, 30, 3.0, 1),
        ],
        "sprint_avg_finish": [_sprint_agg(1, 4, 2, 25), _sprint_agg(2, 4, 0, 14), _sprint_agg(3, 2, 0, 3)],
        # A third, slower team sets the field minimum so the two teams score car 0.9 / 0.4, reliability 0.8 / 0.6.
        "median_finish": [_team_agg(100, 4.8, 10, 2), _team_agg(200, 12.4, 10, 4), _team_agg(300, 262 / 15, 10, 0)],
        "SELECT race_date FROM races WHERE id": {"race_date": RACE_DAY},
        "rr.grid_position, rr.finish_position": [
            {"driver_id": 1, "grid_position": 1, "finish_position": 1},
            {"driver_id": 1, "grid_position": 2, "finish_position": 1},
            {"driver_id": 2, "grid_position": 3, "finish_position": 5},
            {"driver_id": 3, "grid_position": 10, "finish_position": 6},
        ],
        "wet_avg": [{"driver_id": 1, "wet_avg": 2.0, "wet_races": 3}, {"driver_id": 2, "wet_avg": 6.0, "wet_races": 2}],
        "sub.best_ms": [
            {"driver_id": 1, "team_id": 100, "best_ms": 80000, "race_date": d1, "rn": 1},
            {"driver_id": 2, "team_id": 100, "best_ms": 80300, "race_date": d1, "rn": 1},
            {"driver_id": 1, "team_id": 100, "best_ms": 81000, "race_date": d0, "rn": 2},
            {"driver_id": 2, "team_id": 100, "best_ms": 80900, "race_date": d0, "rn": 2},
            {"driver_id": 3, "team_id": 200, "best_ms": 82000, "race_date": d1, "rn": 1},
        ],
        "cat_avg": [
            {"driver_id": 1, "cat_avg": 2.0, "cat_n": 4},
            {"driver_id": 2, "cat_avg": 5.0, "cat_n": 3},
            {"driver_id": 3, "cat_avg": 12.0, "cat_n": 1},
        ],
    }


def _sprint_routes():
    return {
        **_season("sprint_qualifying"),
        "SELECT sr.driver_id": [
            {"driver_id": 1, "best_ms": 88000}, {"driver_id": 2, "best_ms": 88400}, {"driver_id": 3, "best_ms": None},
        ],
    }


def _capture_upserts(monkeypatch) -> list:
    """(table, rows as dicts) per upsert, recovered from the composed INSERT's column identifiers."""
    batches = []

    def execute_batch(cur, query, params, page_size=100):
        cols = [part.strings[0] for part in query.seq[3].seq if isinstance(part, sql.Identifier)]
        batches.append((query.seq[1].strings[0], [dict(zip(cols, p)) for p in params]))

    monkeypatch.setattr(upsert_module, "execute_batch", execute_batch)
    return batches


def _written(monkeypatch, job, routes):
    conn = _RoutedConnection(routes)
    monkeypatch.setattr(feature_runner, "get_conn", lambda: conn)
    batches = _capture_upserts(monkeypatch)
    job.run(50)
    return batches, conn


def _row(driver_id, **scores):
    return {"race_id": 50, "driver_id": driver_id, "track_overtake_score": None,
            "win_probability": 0.0, "predicted_position": None, **scores}


SPRINT_ROWS = [
    _row(1, car_performance_score=0.9175, circuit_adj_start_pos_score=1.0, short_run_pace_score=1.0,
         driver_rating_score=0.78125, weather_impact_score=0.5, win_rate_score=0.41667, luck_factor_score=0.44828,
         sq_qualifying_delta_score=1.0, starting_position_score=1.0, raw_weighted_score=0.826695),
    _row(2, car_performance_score=0.82125, circuit_adj_start_pos_score=0.884, short_run_pace_score=0.0,
         driver_rating_score=0.4375, weather_impact_score=0.5, win_rate_score=0.08333, luck_factor_score=0.0,
         sq_qualifying_delta_score=0.0, starting_position_score=0.65, raw_weighted_score=0.516729),
    # Two sprints is too few for a sprint rating: driver 3 falls back to GP rating and win rate.
    _row(3, car_performance_score=0.4, circuit_adj_start_pos_score=0.408, short_run_pace_score=0.5,
         driver_rating_score=0.15, weather_impact_score=0.5, win_rate_score=0.05, luck_factor_score=1.0,
         sq_qualifying_delta_score=0.50138, starting_position_score=0.3, raw_weighted_score=0.421083),
]


class TestFeatureJobs:
    def test_sprint_features_write_sprint_v2_scores(self, monkeypatch):
        from src.jobs import compute_sprint_features

        batches, conn = _written(monkeypatch, compute_sprint_features, _sprint_routes())

        assert batches == [("driver_sprint_features", SPRINT_ROWS)]
        assert "wet_avg" not in conn.queries
        assert conn.closed is True


def _spec(**overrides):
    defaults = dict(
        job_name="test_features", model_version="test-v1", feature_table="driver_sprint_features",
        features=SPRINT_FEATURES, grid_table="sprint_results", grid_missing="no grid for race {race_id}",
        weather=lambda ctx: "dry",
        score_drivers=lambda conn, ctx: lambda driver_id, stat: ModelScores(features={
            "short_run_pace": 0.5, "driver_rating": 0.5, "win_rate": 0.5, "sq_qualifying_delta": 0.5,
        }),
    )
    return FeatureJobSpec(**{**defaults, **overrides})


def _run_spec(monkeypatch, spec, routes):
    conn = _RoutedConnection(routes)
    monkeypatch.setattr(feature_runner, "get_conn", lambda: conn)
    try:
        feature_runner.run_feature_job(spec, 50)
    finally:
        assert conn.closed is True


class TestRunFeatureJob:
    def test_a_race_without_a_grid_fails_with_the_specs_message(self, monkeypatch):
        routes = {**_sprint_routes(), "g.grid_position FROM": []}
        with pytest.raises(ValueError, match="^no grid for race 50$"):
            _run_spec(monkeypatch, _spec(), routes)

    def test_a_model_that_leaves_a_manifest_feature_unscored_writes_nothing(self, monkeypatch):
        batches = _capture_upserts(monkeypatch)
        spec = _spec(score_drivers=lambda conn, ctx: lambda d, stat: ModelScores(features={"short_run_pace": 0.5}))
        with pytest.raises(KeyError, match="driver_rating"):
            _run_spec(monkeypatch, spec, _sprint_routes())
        assert batches == []

    def test_scores_combine_the_shared_features_with_the_models_by_manifest_weight(self, monkeypatch):
        batches = _capture_upserts(monkeypatch)
        _run_spec(monkeypatch, _spec(), _sprint_routes())
        (table, rows), = batches
        assert table == "driver_sprint_features"
        # Driver 3: shared car 0.4, adjusted start 0.408, luck 1.0, dry weather 0.5; model scores all 0.5.
        # 0.25*0.4 + 0.25*0.408 + 0.08*1.0 + 0.08*0.5 + (0.10+0.10+0.08+0.06)*0.5 = 0.492
        assert rows[2]["raw_weighted_score"] == 0.492

    def test_model_columns_are_written_beside_the_scores(self, monkeypatch):
        batches = _capture_upserts(monkeypatch)
        spec = _spec(score_drivers=lambda conn, ctx: lambda d, stat: ModelScores(
            features={"short_run_pace": 0.5, "driver_rating": 0.5, "win_rate": 0.5, "sq_qualifying_delta": 0.5},
            columns={"long_run_used_fp": False},
        ))
        _run_spec(monkeypatch, spec, _sprint_routes())
        assert [row["long_run_used_fp"] for row in batches[0][1]] == [False, False, False]
