from src.utils.quality_utils import SEVERITY_POINTS, health_from_issues, is_fixable


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


def test_is_fixable_matches_having_a_repair_path():
    # A check is fixable exactly when weekend_pipeline.repair_steps has a path for it.
    assert is_fixable("qualifying_results", "row_count") is True
    assert is_fixable("race_results", "points_present") is True
    assert is_fixable("lap_times", "lap_time_present") is True
    assert is_fixable("fp2_long_run_times", "driver_coverage") is False
    assert is_fixable("weird", "x") is False