"""sprint-v2 end to end against a fake DB. Reads are routed by a marker in their SQL (they are independent,
so their order is the job's business); upsert's execute_batch is patched (it needs a real connection to render
SQL) and the written rows are read back from its params. The Feature Scores are the rows sprint-v2 wrote
before it became one module: a refactor must not move a single one."""
from datetime import date

import pytest
from psycopg2 import sql

import src.utils.upsert as upsert_module
from src.jobs import compute_sprint_features
from tests.support.fake_db import FakeConnection

RACE_DAY = date(2026, 5, 3)


class _RoutedCursor:
    def __init__(self, routes: dict[str, object], log: list[tuple[str, object]]):
        self._routes, self._log, self._rows = routes, log, []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, query, params=None):
        marker = next((m for m in self._routes if m in str(query)), None)
        if marker is None:
            raise AssertionError(f"unscripted query: {query}")
        self._log.append((marker, params))
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


def _routes(event_format="sprint_qualifying"):
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
        "d.first_name, d.last_name FROM drivers": [
            {"id": 1, "code": "AAA", "first_name": "Ann", "last_name": "One"},
            {"id": 2, "code": "BBB", "first_name": "Bea", "last_name": "Two"},
            {"id": 3, "code": "CCC", "first_name": "Cy", "last_name": "Three"},
        ],
        "rr.grid_position, rr.finish_position": [
            {"driver_id": 1, "grid_position": 1, "finish_position": 1},
            {"driver_id": 1, "grid_position": 2, "finish_position": 1},
            {"driver_id": 2, "grid_position": 3, "finish_position": 5},
            {"driver_id": 3, "grid_position": 10, "finish_position": 6},
        ],
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
        "FROM sprint_results t": [
            {"driver_id": 1, "best_ms": 88000}, {"driver_id": 2, "best_ms": 88400}, {"driver_id": 3, "best_ms": None},
        ],
        "DELETE FROM driver_sprint_features": [],
    }


def _capture_upserts(monkeypatch) -> list:
    """(table, rows as dicts) per upsert, recovered from the composed INSERT's column identifiers."""
    batches = []

    def execute_batch(cur, query, params, page_size=100):
        cols = [part.strings[0] for part in query.seq[3].seq if isinstance(part, sql.Identifier)]
        batches.append((query.seq[1].strings[0], [dict(zip(cols, p)) for p in params]))

    monkeypatch.setattr(upsert_module, "execute_batch", execute_batch)
    return batches


def _run(monkeypatch, routes):
    conn = _RoutedConnection(routes)
    monkeypatch.setattr(compute_sprint_features, "get_conn", lambda: conn)
    batches = _capture_upserts(monkeypatch)
    try:
        compute_sprint_features.run(50)
    finally:
        assert conn.closed is True
    return batches, conn


def _row(driver_id, **scores):
    return {"race_id": 50, "driver_id": driver_id, **scores}


SPRINT_ROWS = [
    _row(1, car_performance_score=0.9175, circuit_adj_start_pos_score=1.0, short_run_pace_score=1.0,
         driver_rating_score=0.78125, weather_impact_score=0.5, win_rate_score=0.41667, luck_factor_score=0.44828,
         sq_qualifying_delta_score=1.0, starting_position_score=1.0, raw_weighted_score=0.826695,
         win_probability=0.61936, predicted_position=1),
    _row(2, car_performance_score=0.82125, circuit_adj_start_pos_score=0.884, short_run_pace_score=0.0,
         driver_rating_score=0.4375, weather_impact_score=0.5, win_rate_score=0.08333, luck_factor_score=0.0,
         sq_qualifying_delta_score=0.0, starting_position_score=0.65, raw_weighted_score=0.516729,
         win_probability=0.2204, predicted_position=2),
    # Two sprints is too few for a sprint rating: driver 3 falls back to GP rating and win rate.
    _row(3, car_performance_score=0.4, circuit_adj_start_pos_score=0.408, short_run_pace_score=0.5,
         driver_rating_score=0.15, weather_impact_score=0.5, win_rate_score=0.05, luck_factor_score=1.0,
         sq_qualifying_delta_score=0.50138, starting_position_score=0.3, raw_weighted_score=0.421083,
         win_probability=0.16024, predicted_position=3),
]


class TestComputeSprintFeatures:
    def test_writes_sprint_v2_scores_probabilities_and_the_winner_in_one_transaction(self, monkeypatch):
        batches, conn = _run(monkeypatch, _routes())

        (features_table, rows), (winner_table, winner) = batches
        assert features_table == "driver_sprint_features"
        assert rows == [pytest.approx(r) for r in SPRINT_ROWS]
        assert winner_table == "sprint_predictions"
        assert winner[0]["predicted_winner_id"] == 1 and winner[0]["model_version"] == "sprint-v2"
        assert conn.commits == 1

    def test_drops_rows_for_drivers_no_longer_on_the_grid(self, monkeypatch):
        _, conn = _run(monkeypatch, _routes())

        (_, params), = [q for q in conn.queries if q[0] == "DELETE FROM driver_sprint_features"]
        assert params[0] == 50 and sorted(params[1]) == [1, 2, 3]

    def test_history_is_read_by_person_not_by_driver_code(self, monkeypatch):
        _, conn = _run(monkeypatch, _routes())

        luck_params = next(p for m, p in conn.queries if m == "rr.grid_position, rr.finish_position")
        assert luck_params[:2] == ([1, 2, 3], [1, 2, 3])
        assert luck_params[2] == RACE_DAY

    def test_falls_back_to_main_qualifying_when_sprint_qualifying_has_no_times(self, monkeypatch):
        routes = {**_routes(), "FROM sprint_results t": [{"driver_id": 1, "best_ms": None}],
                  "FROM qualifying_results t": [{"driver_id": 1, "best_ms": 80000}, {"driver_id": 2, "best_ms": 81000}]}

        batches, _ = _run(monkeypatch, routes)

        pace = {r["driver_id"]: r["short_run_pace_score"] for r in batches[0][1]}
        assert pace == {1: 1.0, 2: 0.0, 3: 0.5}

    def test_refuses_a_conventional_weekend(self, monkeypatch):
        with pytest.raises(ValueError, match="only runs on sprint weekends"):
            _run(monkeypatch, _routes(event_format="conventional"))

    def test_a_race_without_a_sprint_grid_fails(self, monkeypatch):
        with pytest.raises(ValueError, match="run ingest_sprint first"):
            _run(monkeypatch, {**_routes(), "g.grid_position FROM": []})


def _pace_rows(*pairs):
    return [{"driver_id": d, "best_ms": ms} for d, ms in pairs]


class TestShortRunPace:
    def test_uses_sprint_qualifying_times_faster_driver_scores_higher(self):
        conn = FakeConnection([_pace_rows((1, 90_000), (2, 91_000), (3, 92_000))])
        assert compute_sprint_features._short_run_pace(conn, [1, 2, 3], race_id=7) == {1: 1.0, 2: 0.5, 3: 0.0}
        assert len(conn.cursors) == 1

    def test_falls_back_to_main_qualifying_when_no_sq_times(self):
        conn = FakeConnection([_pace_rows((1, None), (2, None)), _pace_rows((1, 88_000), (2, 90_000))])
        assert compute_sprint_features._short_run_pace(conn, [1, 2], race_id=7) == {1: 1.0, 2: 0.0}
        assert len(conn.cursors) == 2

    def test_neutral_score_when_neither_source_has_data(self):
        conn = FakeConnection([[], []])
        assert compute_sprint_features._short_run_pace(conn, [1, 2, 3], race_id=7) == {1: 0.5, 2: 0.5, 3: 0.5}

    def test_driver_without_a_time_gets_the_neutral_fallback(self):
        conn = FakeConnection([_pace_rows((1, 90_000), (2, 92_000), (3, None))])
        assert compute_sprint_features._short_run_pace(conn, [1, 2, 3], race_id=7) == {1: 1.0, 2: 0.0, 3: 0.5}

    def test_identical_times_collapse_to_neutral(self):
        conn = FakeConnection([_pace_rows((1, 90_000), (2, 90_000))])
        assert compute_sprint_features._short_run_pace(conn, [1, 2], race_id=7) == {1: 0.5, 2: 0.5}

    def test_driver_ids_absent_from_result_rows_default_to_neutral(self):
        conn = FakeConnection([_pace_rows((1, 90_000), (2, 92_000))])
        assert compute_sprint_features._short_run_pace(conn, [1, 2, 99], race_id=7)[99] == 0.5
