"""Downloads an F1DB release (CC-BY-4.0), verifies its SHA-256 against the release's own checksum
file, extracts it into a fresh temp dir and imports it. Local only — never on Render.
Usage: python scripts/import_f1db.py [--version v2026.16.1]   (default: latest release)"""
import argparse
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, ".")
sys.path.insert(0, "scripts")

from f1db_release import fetch_release, latest_version
from src.jobs.import_f1db import run

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", default=None)
    args = parser.parse_args()
    version = args.version or latest_version()

    with tempfile.TemporaryDirectory(prefix="f1db-") as tmp:
        run(str(fetch_release(version, Path(tmp))), version)
