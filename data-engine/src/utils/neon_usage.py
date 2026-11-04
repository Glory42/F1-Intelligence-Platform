"""Neon Free usage read from Neon's control-plane API: it never wakes the database compute."""
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

import requests


@dataclass(frozen=True)
class NeonUsage:
    compute_seconds: float
    transfer_bytes: int
    period_start: datetime
    period_end: datetime


@dataclass(frozen=True)
class UsageProjection:
    cu_hours_used: float
    egress_gb_used: float
    cu_hours_projected: float
    egress_gb_projected: float

    @property
    def over_budget(self) -> bool:
        """Already used: only then does the API stop refreshing, so fresh results never hide on a guess."""
        return self.cu_hours_used > CU_HOURS_BUDGET or self.egress_gb_used > EGRESS_GB_BUDGET

    @property
    def on_pace_over_budget(self) -> bool:
        return self.cu_hours_projected > CU_HOURS_BUDGET or self.egress_gb_projected > EGRESS_GB_BUDGET


# Headroom under Neon Free's 100 CU-h and 5 GB: the worker logs a failure past these.
CU_HOURS_BUDGET = 80
EGRESS_GB_BUDGET = 4
# A pace measured over a few hours is noise: project from at least the first tenth (~3 days).
MIN_ELAPSED_FRACTION = 0.1


def project_usage(usage: NeonUsage, now: datetime) -> UsageProjection:
    elapsed = max((now - usage.period_start) / (usage.period_end - usage.period_start), MIN_ELAPSED_FRACTION)
    cu_hours, egress_gb = usage.compute_seconds / 3600, usage.transfer_bytes / 1_000_000_000
    return UsageProjection(
        cu_hours_used=cu_hours,
        egress_gb_used=egress_gb,
        cu_hours_projected=cu_hours / elapsed,
        egress_gb_projected=egress_gb / elapsed,
    )


def fetch_neon_usage() -> Optional[NeonUsage]:
    """None when NEON_API_KEY / NEON_PROJECT_ID aren't set (tests, local dev)."""
    key, project = os.environ.get("NEON_API_KEY"), os.environ.get("NEON_PROJECT_ID")
    if not key or not project:
        return None
    res = requests.get(
        f"https://console.neon.tech/api/v2/projects/{project}",
        headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
        timeout=10,
    )
    res.raise_for_status()
    p = res.json()["project"]
    return NeonUsage(
        compute_seconds=p["compute_time_seconds"],
        transfer_bytes=p["data_transfer_bytes"],
        period_start=datetime.fromisoformat(p["consumption_period_start"].replace("Z", "+00:00")),
        period_end=datetime.fromisoformat(p["consumption_period_end"].replace("Z", "+00:00")),
    )
