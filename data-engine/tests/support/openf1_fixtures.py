import json
from pathlib import Path

_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "openf1"


def load_openf1_fixture(name: str) -> list[dict]:
    """Real OpenF1 responses recorded once (trimmed to a few drivers): an independent
    source of truth for mapper tests, rather than payloads hand-written to match the code."""
    return json.loads((_DIR / f"{name}.json").read_text())
