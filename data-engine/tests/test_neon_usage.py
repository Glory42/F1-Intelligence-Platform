from datetime import datetime, timezone

from src.utils.neon_usage import NeonUsage, project_usage

NOVEMBER = (datetime(2026, 11, 1, tzinfo=timezone.utc), datetime(2026, 12, 1, tzinfo=timezone.utc))
MID_NOVEMBER = datetime(2026, 11, 16, tzinfo=timezone.utc)
GB = 1_000_000_000


def _usage(cu_hours: float, egress_gb: float) -> NeonUsage:
    return NeonUsage(
        compute_seconds=cu_hours * 3600,
        transfer_bytes=int(egress_gb * GB),
        period_start=NOVEMBER[0],
        period_end=NOVEMBER[1],
    )


def test_projects_compute_to_the_end_of_the_period_at_the_pace_so_far():
    projection = project_usage(_usage(cu_hours=30, egress_gb=1), MID_NOVEMBER)

    assert projection.cu_hours_projected == 60


def test_is_over_budget_once_eighty_cu_hours_are_already_used():
    assert project_usage(_usage(cu_hours=81, egress_gb=1), MID_NOVEMBER).over_budget


def test_is_over_budget_once_four_gb_of_egress_are_already_used():
    assert project_usage(_usage(cu_hours=10, egress_gb=4.1), MID_NOVEMBER).over_budget


def test_a_month_merely_on_pace_to_pass_the_budget_is_not_over_it_yet():
    projection = project_usage(_usage(cu_hours=45, egress_gb=1), MID_NOVEMBER)

    assert not projection.over_budget and projection.on_pace_over_budget


def test_is_on_pace_over_budget_when_egress_alone_heads_past_four_gb():
    assert project_usage(_usage(cu_hours=10, egress_gb=2.5), MID_NOVEMBER).on_pace_over_budget


def test_a_busy_first_morning_does_not_project_the_month_over_budget():
    first_morning = datetime(2026, 11, 1, 6, tzinfo=timezone.utc)

    assert not project_usage(_usage(cu_hours=2, egress_gb=0.1), first_morning).on_pace_over_budget
