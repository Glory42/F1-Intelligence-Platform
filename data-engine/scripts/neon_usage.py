"""Neon Free usage this month and where it's heading, from Neon's control-plane API: never wakes the
database. Needs NEON_API_KEY and NEON_PROJECT_ID. Usage: python scripts/neon_usage.py"""
import sys
from datetime import datetime, timezone

sys.path.insert(0, ".")

from src.utils.neon_usage import CU_HOURS_BUDGET, EGRESS_GB_BUDGET, fetch_neon_usage, project_usage

if __name__ == "__main__":
    usage = fetch_neon_usage()
    if usage is None:
        raise SystemExit("Set NEON_API_KEY and NEON_PROJECT_ID.")
    projection = project_usage(usage, datetime.now(timezone.utc))
    print(f"Period      {usage.period_start:%Y-%m-%d} to {usage.period_end:%Y-%m-%d}")
    print(f"Compute     {usage.compute_seconds / 3600:6.1f} CU-h used, {projection.cu_hours_projected:6.1f} projected (budget {CU_HOURS_BUDGET}, limit 100)")
    print(f"Egress      {usage.transfer_bytes / 1e9:6.2f} GB used,   {projection.egress_gb_projected:6.2f} projected (budget {EGRESS_GB_BUDGET}, limit 5)")
    if projection.over_budget:
        print("Over budget: the API serves stale cache")
    elif projection.on_pace_over_budget:
        print("On pace to pass the budget: the API still reads Neon until usage actually crosses it")
    else:
        print("Within budget")
