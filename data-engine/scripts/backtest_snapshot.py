"""Copies Neon into the local backtest Postgres (docker-compose.backtest.yml). Read-only on Neon; run it
once, then again only when you want newer races. Skips the data of tables no model reads, to keep
egress small (~85 MB). Usage: python scripts/backtest_snapshot.py"""
import pathlib
import subprocess
import sys

sys.path.insert(0, ".")

from src.config import DATABASE_URL
from scripts.backtest import BACKTEST_DATABASE_URL

DUMP_PATH = pathlib.Path("cache/backtest/neon.dump")
SKIPPED_TABLE_DATA = ("qualifying_lap_telemetry", "team_radio_clips")


def main() -> None:
    subprocess.run(["docker", "compose", "-f", "docker-compose.backtest.yml", "up", "-d", "--wait"], check=True)
    DUMP_PATH.parent.mkdir(parents=True, exist_ok=True)
    # pg_dump needs a session, which Neon's transaction-mode pooler doesn't keep: use the direct host.
    source = DATABASE_URL.replace("-pooler.", ".")
    print("Dumping Neon (read-only)...")
    subprocess.run(
        ["pg_dump", "--format=custom", "--no-owner", "--no-privileges", f"--file={DUMP_PATH}",
         *(f"--exclude-table-data={t}" for t in SKIPPED_TABLE_DATA), source],
        check=True,
    )
    print(f"Restoring {DUMP_PATH.stat().st_size / 1e6:.0f} MB into the backtest database...")
    subprocess.run(
        ["pg_restore", "--clean", "--if-exists", "--no-owner", "--no-privileges",
         f"--dbname={BACKTEST_DATABASE_URL}", str(DUMP_PATH)],
        check=True,
    )
    print("Done.")


if __name__ == "__main__":
    main()
