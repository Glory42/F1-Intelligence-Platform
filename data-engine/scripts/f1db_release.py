"""Downloads an F1DB release (CC-BY-4.0) and verifies its SHA-256 against the release's own
checksum file. Shared by the import, audit and backfill scripts. Local only: never on Render."""
import hashlib
import zipfile
from pathlib import Path

import requests

ASSET = "f1db-json-splitted.zip"
RELEASES = "https://github.com/f1db/f1db/releases"


def latest_version() -> str:
    resp = requests.get("https://api.github.com/repos/f1db/f1db/releases/latest", timeout=30)
    resp.raise_for_status()
    return resp.json()["tag_name"]


def _download(url: str, dest: Path) -> None:
    with requests.get(url, timeout=120, stream=True) as resp:
        resp.raise_for_status()
        with dest.open("wb") as fh:
            for chunk in resp.iter_content(chunk_size=1 << 16):
                fh.write(chunk)


def _expected_sha256(version: str) -> str:
    resp = requests.get(f"{RELEASES}/download/{version}/checksums_sha256.txt", timeout=30)
    resp.raise_for_status()
    for line in resp.text.splitlines():
        digest, _, name = line.partition("  ")
        if name.strip() == ASSET:
            return digest
    raise SystemExit(f"{ASSET} missing from the {version} checksum file")


def fetch_release(version: str, workdir: Path) -> Path:
    """Downloads, verifies and extracts `version` under `workdir`; returns the extracted dir."""
    archive = workdir / ASSET
    _download(f"{RELEASES}/download/{version}/{ASSET}", archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != _expected_sha256(version):
        raise SystemExit(f"Checksum mismatch for {ASSET} {version}: refusing to use it")
    extracted = workdir / "release"
    with zipfile.ZipFile(archive) as zf:
        zf.extractall(extracted)
    return extracted
