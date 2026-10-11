from typing import Any

# Severity -> points deducted from a per-race 100 health baseline.
SEVERITY_POINTS = {"high": 8, "medium": 4, "low": 1}


def health_from_issues(issues: list[dict[str, Any]]) -> float:
    """Per-race health: start at 100 and subtract severity points, floor 0."""
    penalty = sum(SEVERITY_POINTS.get(i["severity"], 0) for i in issues)
    return max(0.0, 100.0 - min(penalty, 100.0))


# Single source of truth for "is this check fixable" and "what heals it": a check is
# fixable exactly when it has a repair path here. data_quality_audit.add() derives its
# `fixable` flag from is_fixable() instead of hand-typing it per call site, so the two
# facts can't drift apart the way they previously did (race_results/points_present and
# lap_times/lap_time_present each had a repair path here but were hardcoded fixable=False
# in the audit, silently making data_quality_repair.run() skip issues it could fix).
ISSUE_REPAIR_STEPS: dict[tuple[str, str], list[str]] = {
    ("qualifying_results", "row_count"): ["ingest_qualifying", "compute_features", "compute_predictions"],
    ("qualifying_results", "q_time_present"): ["ingest_qualifying", "compute_features", "compute_predictions"],
    ("race_results", "row_count"): ["ingest_race", "compute_season_stats"],
    ("race_results", "points_present"): ["ingest_race", "compute_season_stats"],
    ("race_results", "winner_present"): ["ingest_race", "compute_season_stats"],
    ("lap_times", "lap_coverage"): ["ingest_race", "compute_features", "compute_predictions"],
    ("lap_times", "lap_time_present"): ["ingest_race", "compute_features", "compute_predictions"],
    ("sprint_results", "row_count"): ["ingest_sprint", "compute_season_stats"],
    ("sprint_lap_times", "lap_coverage"): ["ingest_sprint"],
    ("driver_prediction_features", "feature_rows"): ["compute_features", "compute_predictions"],
    ("race_predictions", "prediction_present"): ["compute_predictions"],
    ("driver_season_stats", "driver_presence"): ["compute_season_stats"],
}


def is_fixable(table_name: str, check_name: str) -> bool:
    return (table_name, check_name) in ISSUE_REPAIR_STEPS


def resolve_issue_actions(issue: dict[str, Any]) -> list[str]:
    """Ordered job names to resolve one issue: ingest first, then downstream recompute.
    Returns [] when the issue has no repair path."""
    return list(ISSUE_REPAIR_STEPS.get((issue.get("table_name"), issue.get("check_name")), []))
