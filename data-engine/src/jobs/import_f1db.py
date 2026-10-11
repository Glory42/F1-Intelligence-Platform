import json
from pathlib import Path

from src.db.client import get_conn
from src.utils.f1db import career_milestones, constructor_row, constructor_seasons, driver_row
from src.utils.storage_guard import read_storage_tier
from src.utils.upsert import upsert


def _load(release_dir: Path, name: str) -> list[dict]:
    return json.loads((release_dir / f"f1db-{name}.json").read_text())


def run(release_dir: str, version: str) -> None:
    """Imports an extracted F1DB *json-splitted* release (bios, career totals, milestones, lineage).
    Never on Render: parsing the release needs more RAM than Render Free has (see f1db-import.yml).
    Skips already-imported versions."""
    root = Path(release_dir)
    print(f"[import_f1db] version={version} dir={root}")

    milestones = career_milestones(_load(root, "races-race-results"), _load(root, "races"))
    drivers = [driver_row(d, milestones.get(d["id"])) for d in _load(root, "drivers")]
    constructors = [constructor_row(c) for c in _load(root, "constructors")]
    seasons = constructor_seasons(
        _load(root, "seasons-entrants-chassis"),
        _load(root, "seasons-entrants-engines"),
        chassis_names={c["id"]: c["name"] for c in _load(root, "chassis")},
        engine_names={e["id"]: e["name"] for e in _load(root, "engine-manufacturers")},
    )
    lineage = [
        {"parent_f1db_id": r["parentConstructorId"], "position": r["positionDisplayOrder"],
         "constructor_f1db_id": r["constructorId"], "year_from": r["yearFrom"], "year_to": r.get("yearTo")}
        for r in _load(root, "constructors-chronology")
    ]

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM f1db_imports WHERE version = %s", (version,))
            if cur.fetchone():
                print(f"  [SKIP] F1DB {version} already imported")
                return
        if not read_storage_tier(conn).allows_backfill:
            print("  [SKIP] Neon storage past the backfill threshold: see storage_guard")
            return
        upsert(conn, "history_drivers", drivers, ["f1db_id"])
        upsert(conn, "history_constructors", constructors, ["f1db_id"])
        upsert(conn, "history_constructor_seasons", seasons, ["constructor_f1db_id", "year"])
        upsert(conn, "history_constructor_lineage", lineage, ["parent_f1db_id", "position"])
        with conn.cursor() as cur:
            cur.execute("INSERT INTO f1db_imports (version) VALUES (%s) ON CONFLICT (version) DO NOTHING", (version,))
        conn.commit()
        print(f"  Imported {len(drivers)} drivers, {len(constructors)} constructors, {len(seasons)} constructor seasons")
    finally:
        conn.close()
