"""Downloads an F1DB release (CC-BY-4.0), verifies its SHA-256 against the release's own checksum
file, extracts it into a fresh temp dir and imports it. Local only — never on Render.
Usage: python scripts/import_f1db.py [--version v2026.16.1]   (default: latest release)"""
import argparse
import hashlib
import sys
import tempfile
import zipfile
from pathlib import Path

import requests

sys.path.insert(0, ".")

from src.jobs.import_f1db import run

ASSET = "f1db-json-splitted.zip"
RELEASES = "https://github.com/f1db/f1db/releases"


def latest_version() -> str:
    resp = requests.get("https://api.github.com/repos/f1db/f1db/releases/latest", timeout=30)
    resp.raise_for_status()
    return resp.json()["tag_name"]


def download(url: str, dest: Path) -> None:
    with requests.get(url, timeout=120, stream=True) as resp:
        resp.raise_for_status()
        with dest.open("wb") as fh:
            for chunk in resp.iter_content(chunk_size=1 << 16):
                fh.write(chunk)


def expected_sha256(version: str) -> str:
    resp = requests.get(f"{RELEASES}/download/{version}/checksums_sha256.txt", timeout=30)
    resp.raise_for_status()
    for line in resp.text.splitlines():
        digest, _, name = line.partition("  ")
        if name.strip() == ASSET:
            return digest
    raise SystemExit(f"{ASSET} missing from the {version} checksum file")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", default=None)
    args = parser.parse_args()
    version = args.version or latest_version()

    with tempfile.TemporaryDirectory(prefix="f1db-") as tmp:
        archive = Path(tmp) / ASSET
        download(f"{RELEASES}/download/{version}/{ASSET}", archive)
        actual = hashlib.sha256(archive.read_bytes()).hexdigest()
        if actual != expected_sha256(version):
            raise SystemExit(f"Checksum mismatch for {ASSET} {version} — refusing to import")
        extracted = Path(tmp) / "release"
        with zipfile.ZipFile(archive) as zf:
            zf.extractall(extracted)
        run(str(extracted), version)
