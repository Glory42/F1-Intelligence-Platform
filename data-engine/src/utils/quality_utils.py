from typing import Any

from src.weekend_pipeline import repair_steps

# Severity -> points deducted from a per-race 100 health baseline.
SEVERITY_POINTS = {"high": 8, "medium": 4, "low": 1}


def health_from_issues(issues: list[dict[str, Any]]) -> float:
    """Per-race health: start at 100 and subtract severity points, floor 0."""
    penalty = sum(SEVERITY_POINTS.get(i["severity"], 0) for i in issues)
    return max(0.0, 100.0 - min(penalty, 100.0))


def is_fixable(table_name: str, check_name: str) -> bool:
    """A check is fixable exactly when data_quality_repair has a path for it, so the audit's
    `fixable` flag and the repair can't drift apart."""
    return bool(repair_steps(table_name, check_name))
