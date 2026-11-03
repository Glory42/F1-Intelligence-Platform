"""Copies Neon into the local dev Postgres (../docker-compose.dev.yml) that wrangler dev, astro dev and
CLI jobs use. Read-only on Neon (~140 MB egress, one wake); rerun only when you want newer races.
Usage: PROD_DATABASE_URL=postgresql://...neon.tech/... python scripts/dev_snapshot.py"""
import os
import pathlib
import sys

sys.path.insert(0, ".")
sys.path.insert(0, "scripts")

from neon_snapshot import copy_neon_into

DEV_DATABASE_URL = os.environ.get("DEV_DATABASE_URL", "postgresql://f1:f1@localhost:5435/f1_dev")

if __name__ == "__main__":
    copy_neon_into(DEV_DATABASE_URL, "../docker-compose.dev.yml", pathlib.Path("cache/dev/neon.dump"))
