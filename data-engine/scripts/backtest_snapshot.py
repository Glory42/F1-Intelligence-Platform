"""Copies Neon into the local backtest Postgres (docker-compose.backtest.yml). Read-only on Neon; run it
once, then again only when you want newer races. Skips the data of tables no model reads, to keep
egress small (~85 MB). Usage: python scripts/backtest_snapshot.py"""
import pathlib
import sys

sys.path.insert(0, ".")
sys.path.insert(0, "scripts")

from neon_snapshot import copy_neon_into
from scripts.backtest import BACKTEST_DATABASE_URL

if __name__ == "__main__":
    copy_neon_into(
        BACKTEST_DATABASE_URL,
        "docker-compose.backtest.yml",
        pathlib.Path("cache/backtest/neon.dump"),
        skipped_table_data=("qualifying_lap_telemetry", "team_radio_clips"),
    )
