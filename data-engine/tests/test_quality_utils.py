from src.utils.quality_utils import SEVERITY_POINTS, health_from_issues, is_fixable, resolve_issue_actions


def _issue(severity):
    return {"severity": severity}


def test_empty_issues_score_full_health():
    assert health_from_issues([]) == 100.0


def test_single_high_deducts_8():
    assert health_from_issues([_issue("high")]) == 92.0


def test_medium_and_low_deduct_5():
    assert health_from_issues([_issue("medium"), _issue("low")]) == 95.0


def test_health_floors_at_zero():
    heavy = [_issue("high")] * 20
    assert health_from_issues(heavy) == 0.0


def test_unknown_severity_warns_but_counts_zero():
    assert health_from_issues([_issue("UNKNOWN")]) == 100.0


def test_severity_points_are_weighted():
    assert SEVERITY_POINTS == {"high": 8, "medium": 4, "low": 1}


def test_resolve_qualifying_issue_recomputes_features():
    issue = {"table_name": "qualifying_results", "check_name": "q_time_present"}
    assert resolve_issue_actions(issue) == [
        "ingest_qualifying", "compute_features", "compute_predictions"
    ]


def test_resolve_race_results_recomputes_season_stats():
    issue = {"table_name": "race_results", "check_name": "points_present"}
    assert resolve_issue_actions(issue) == ["ingest_race", "compute_season_stats"]


def test_resolve_feature_rows_only_recomputes():
    issue = {"table_name": "driver_prediction_features", "check_name": "feature_rows"}
    assert resolve_issue_actions(issue) == ["compute_features", "compute_predictions"]


def test_resolve_prediction_present():
    assert resolve_issue_actions({"table_name": "race_predictions", "check_name": "prediction_present"}) == ["compute_predictions"]


def test_fp2_has_no_resolve_path():
    # FP2 is informational (fallback), not re-ingestable -> no repair steps.
    assert resolve_issue_actions({"table_name": "fp2_long_run_times", "check_name": "driver_coverage"}) == []


def test_unknown_issue_has_no_path():
    assert resolve_issue_actions({"table_name": "weird", "check_name": "x"}) == []


def test_lap_coverage_maps_to_race_ingest():
    assert resolve_issue_actions({"table_name": "lap_times", "check_name": "lap_coverage"}) == [
        "ingest_race", "compute_features", "compute_predictions"
    ]


def test_is_fixable_matches_having_a_repair_path():
    # A check is fixable exactly when a repair path exists for it: the single fact
    # data_quality_audit.add() and resolve_issue_actions both derive from.
    assert is_fixable("qualifying_results", "row_count") is True
    assert is_fixable("race_results", "points_present") is True
    assert is_fixable("lap_times", "lap_time_present") is True
    assert is_fixable("fp2_long_run_times", "driver_coverage") is False
    assert is_fixable("weird", "x") is False