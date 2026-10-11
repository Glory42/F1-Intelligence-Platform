import json
from pathlib import Path

_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "f1db"


def load_f1db_fixture(name: str) -> list[dict]:
    """Trimmed records from the real F1DB v2026.16.1 release (CC-BY-4.0): independent truth."""
    return json.loads((_DIR / f"{name}.json").read_text())
