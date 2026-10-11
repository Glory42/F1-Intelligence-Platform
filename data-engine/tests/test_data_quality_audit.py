"""Covers data_quality_audit._audit_race: the per-race gate/threshold branching
that decides which quality issues fire. Driven by FakeConnection: _audit_race calls
_query/_scalar once per DB round-trip, so each scenario scripts result sets in the
exact order the triggered blocks query them.

Query order inside _audit_race (a block is skipped entirely when its guard is false):
  A. qualifying_results   status in (qualifying_done, completed) and year >= 2018
       A1 grid-duplicate string_agg   A2 missing-Q-time count   A3 sector coverage
  B. race_results         status == completed
       B1 winner present (SELECT 1)   B2 NULL-points count
  C. lap_times            status == completed and year >= 2018 and lap_count > 0
       C1 laps/drivers/null_times     (sprint only) C2 sprint_results count  C3 sprint laps
  D. fp2_long_run_times   status in (qualifying_done, completed) and year >= 2018
                          and expected_grid > 0 and not sprint
       D1 distinct FP2 driver count
  E. driver_season_stats  status == completed and run_season_stats
       E1 drivers-missing-season-stats count
  F. driver_prediction_features   status in (qualifying_done, completed)
       F1 feature-row count          F2 win_probability sum
  G. race_predictions     status == completed
       G1 prediction present (SELECT 1)
"""
from src.jobs.data_quality_audit import _audit_race
from tests.support.fake_db import FakeConnection


def _race(**over):
    base = dict(
        id=1, round_number=5, name="Test GP", status="completed",
        event_format="conventional", season_id=1, year=2024,
        lap_count=57, quali_count=20, result_count=20,
    )
    base.update(over)
    return base


def _audit(race, responses=(), *, run_season_stats=False):
    conn = FakeConnection(list(responses))
    return _audit_race(conn, race, run_season_stats=run_season_stats)


# Healthy result sets for each numbered query, for a 20-car conventional grid.
_OK_A = [{"s": None}, {"n": 0}, {"cov": 0.98}]
_OK_B = [{"x": 1}, {"n": 0}]
_OK_C = [{"laps": 1100, "drivers": 20, "null_times": 0}]
_OK_D = [{"c": 20}]
_OK_F = [{"c": 20}, {"s": 1.0}]
_OK_G = [{"x": 1}]

_CLEAN_COMPLETED = _OK_A + _OK_B + _OK_C + _OK_D + _OK_F + _OK_G


def _codes(issues):
    return {(i["table_name"], i["check_name"]) for i in issues}


class TestStatusGating:
    def test_scheduled_race_makes_no_queries_and_is_fully_healthy(self):
        issues, health = _audit(_race(status="scheduled"))
        assert issues == []
        assert health == 100.0

    def test_clean_completed_race_has_no_issues(self):
        issues, health = _audit(_race(), _CLEAN_COMPLETED)
        assert issues == []
        assert health == 100.0

    def test_pre_2018_completed_race_skips_qualifying_lap_and_fp2_blocks(self):
        # year < 2018 -> only blocks B, F, G run (no A/C/D queries).
        issues, _ = _audit(_race(year=2017), _OK_B + _OK_F + _OK_G)
        assert not any(
            t in ("qualifying_results", "lap_times", "fp2_long_run_times")
            for t, _ in _codes(issues)
        )

    def test_qualifying_done_runs_quali_fp2_and_feature_blocks_only(self):
        # status qualifying_done -> A, D, F run; B, C, E, G skipped.
        issues, _ = _audit(_race(status="qualifying_done"), _OK_A + _OK_D + _OK_F)
        assert issues == []


class TestQualifyingResultsChecks:
    def test_low_row_count_against_race_results_reference_is_high(self):
        # quali_expected = result_count (20) -> threshold int(20*0.9)=18; 10 < 18.
        issues, _ = _audit(_race(quali_count=10), _OK_A + _OK_B + _OK_C + _OK_D + _OK_F + _OK_G)
        row = next(i for i in issues if i["check_name"] == "row_count" and i["table_name"] == "qualifying_results")
        assert row["severity"] == "high"
        assert row["fixable"] is True

    def test_duplicate_grid_positions_flagged_medium(self):
        resp = [{"s": "3,7"}, {"n": 0}, {"cov": 0.98}] + _OK_B + _OK_C + _OK_D + _OK_F + _OK_G
        issues, _ = _audit(_race(), resp)
        dup = next(i for i in issues if i["check_name"] == "grid_duplicates")
        assert dup["severity"] == "medium"
        assert "3,7" in dup["detail"]

    def test_missing_q_times_flagged_medium(self):
        resp = [{"s": None}, {"n": 4}, {"cov": 0.98}] + _OK_B + _OK_C + _OK_D + _OK_F + _OK_G
        issues, _ = _audit(_race(), resp)
        assert next(i for i in issues if i["check_name"] == "q_time_present")["severity"] == "medium"

    def test_sector_coverage_below_ninety_percent_flagged_low(self):
        resp = [{"s": None}, {"n": 0}, {"cov": 0.82}] + _OK_B + _OK_C + _OK_D + _OK_F + _OK_G
        issues, _ = _audit(_race(), resp)
        assert next(i for i in issues if i["check_name"] == "sector_times")["severity"] == "low"

    def test_sector_coverage_none_does_not_flag(self):
        resp = [{"s": None}, {"n": 0}, {"cov": None}] + _OK_B + _OK_C + _OK_D + _OK_F + _OK_G
        issues, _ = _audit(_race(), resp)
        assert not any(i["check_name"] == "sector_times" for i in issues)


class TestRaceResultsChecks:
    def test_low_result_row_count_is_high(self):
        # result_count 5 < max(10, expected_grid=20).
        issues, _ = _audit(_race(result_count=5), _OK_A + _OK_B + _OK_C + _OK_D + _OK_F + _OK_G)
        row = next(i for i in issues if i["table_name"] == "race_results" and i["check_name"] == "row_count")
        assert row["severity"] == "high"

    def test_no_winner_row_is_high(self):
        resp = _OK_A + [None, {"n": 0}] + _OK_C + _OK_D + _OK_F + _OK_G
        issues, _ = _audit(_race(), resp)
        assert next(i for i in issues if i["check_name"] == "winner_present")["severity"] == "high"

    def test_null_points_flagged_low(self):
        resp = _OK_A + [{"x": 1}, {"n": 3}] + _OK_C + _OK_D + _OK_F + _OK_G
        issues, _ = _audit(_race(), resp)
        pts = next(i for i in issues if i["check_name"] == "points_present")
        assert pts["severity"] == "low"
        assert "3 drivers" in pts["detail"]


class TestLapTimesChecks:
    def test_coverage_between_50_and_55_percent_is_medium(self):
        # 620 / (20 * 57 = 1140) = 0.544 -> below LAP_COVERAGE_GATE 0.55, >= 0.5.
        resp = _OK_A + _OK_B + [{"laps": 620, "drivers": 20, "null_times": 0}] + _OK_D + _OK_F + _OK_G
        issues, _ = _audit(_race(), resp)
        assert next(i for i in issues if i["check_name"] == "lap_coverage")["severity"] == "medium"

    def test_coverage_below_50_percent_is_high(self):
        resp = _OK_A + _OK_B + [{"laps": 400, "drivers": 20, "null_times": 0}] + _OK_D + _OK_F + _OK_G
        issues, _ = _audit(_race(), resp)
        assert next(i for i in issues if i["check_name"] == "lap_coverage")["severity"] == "high"

    def test_healthy_coverage_with_null_times_flags_only_lap_time_present(self):
        resp = _OK_A + _OK_B + [{"laps": 1100, "drivers": 20, "null_times": 12}] + _OK_D + _OK_F + _OK_G
        issues, _ = _audit(_race(), resp)
        codes = _codes(issues)
        assert ("lap_times", "lap_time_present") in codes
        assert ("lap_times", "lap_coverage") not in codes

    def test_lap_block_skipped_when_circuit_has_no_lap_count(self):
        # lap_count 0 -> block C makes no query; omit its result set entirely.
        issues, _ = _audit(_race(lap_count=0), _OK_A + _OK_B + _OK_D + _OK_F + _OK_G)
        assert not any(t == "lap_times" for t, _ in _codes(issues))


class TestSprintChecks:
    def test_sprint_weekend_flags_missing_sprint_results_and_laps(self):
        # is_sprint -> block C adds C2 (sprint_results count) + C3 (sprint laps);
        # block D (FP2) is skipped for sprint weekends.
        resp = (
            _OK_A + _OK_B
            + [{"laps": 1100, "drivers": 20, "null_times": 0}, {"n": 3}, {"n": 0}]
            + _OK_F + _OK_G
        )
        issues, _ = _audit(_race(event_format="sprint"), resp)
        codes = _codes(issues)
        assert ("sprint_results", "row_count") in codes
        assert ("sprint_lap_times", "lap_coverage") in codes

    def test_sprint_weekend_with_full_sprint_data_is_clean(self):
        resp = (
            _OK_A + _OK_B
            + [{"laps": 1100, "drivers": 20, "null_times": 0}, {"n": 20}, {"n": 400}]
            + _OK_F + _OK_G
        )
        issues, _ = _audit(_race(event_format="sprint"), resp)
        assert issues == []


class TestFp2AndSeasonStatsChecks:
    def test_low_fp2_coverage_flagged_low(self):
        # 10 / 20 = 0.5 -> below FP2_COVERAGE_GATE 0.7.
        resp = _OK_A + _OK_B + _OK_C + [{"c": 10}] + _OK_F + _OK_G
        issues, _ = _audit(_race(), resp)
        fp2 = next(i for i in issues if i["table_name"] == "fp2_long_run_times")
        assert fp2["severity"] == "low"
        assert fp2["fixable"] is False

    def test_season_stats_gap_emitted_only_when_run_season_stats_true(self):
        resp = _OK_A + _OK_B + _OK_C + _OK_D + [{"n": 4}] + _OK_F + _OK_G
        issues, _ = _audit(_race(), resp, run_season_stats=True)
        dss = next(i for i in issues if i["table_name"] == "driver_season_stats")
        assert dss["severity"] == "medium"
        assert "4 drivers" in dss["detail"]

    def test_season_stats_query_not_made_when_flag_false(self):
        # No E1 result set queued; a clean run proves the query was skipped.
        issues, _ = _audit(_race(), _CLEAN_COMPLETED, run_season_stats=False)
        assert issues == []


class TestPredictionPipelineChecks:
    def test_too_few_feature_rows_is_high(self):
        # fc 10 < max(15, int(20*0.9)=18).
        resp = _OK_A + _OK_B + _OK_C + _OK_D + [{"c": 10}, {"s": 1.0}] + _OK_G
        issues, _ = _audit(_race(), resp)
        assert next(i for i in issues if i["check_name"] == "feature_rows")["severity"] == "high"

    def test_win_probability_not_summing_to_one_is_medium(self):
        resp = _OK_A + _OK_B + _OK_C + _OK_D + [{"c": 20}, {"s": 0.62}] + _OK_G
        issues, _ = _audit(_race(), resp)
        prob = next(i for i in issues if i["check_name"] == "probability_sum")
        assert prob["severity"] == "medium"
        assert "0.620" in prob["detail"]

    def test_probability_sum_null_does_not_flag(self):
        resp = _OK_A + _OK_B + _OK_C + _OK_D + [{"c": 20}, {"s": None}] + _OK_G
        issues, _ = _audit(_race(), resp)
        assert not any(i["check_name"] == "probability_sum" for i in issues)

    def test_completed_race_without_prediction_row_is_high(self):
        resp = _OK_A + _OK_B + _OK_C + _OK_D + _OK_F + [None]
        issues, _ = _audit(_race(), resp)
        pred = next(i for i in issues if i["check_name"] == "prediction_present")
        assert pred["severity"] == "high"


class TestHealthScore:
    def test_health_subtracts_severity_points_from_100(self):
        # One high (winner_present) = -8.
        resp = _OK_A + [None, {"n": 0}] + _OK_C + _OK_D + _OK_F + _OK_G
        _, health = _audit(_race(), resp)
        assert health == 92.0

    def test_every_issue_carries_race_identity(self):
        resp = _OK_A + [None, {"n": 0}] + _OK_C + _OK_D + _OK_F + _OK_G
        issues, _ = _audit(_race(id=42, round_number=9, year=2023), resp)
        for i in issues:
            assert (i["race_id"], i["round_number"], i["year"]) == (42, 9, 2023)
