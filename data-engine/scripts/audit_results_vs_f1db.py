"""Read-only audit: compares every completed race's race / qualifying / sprint results with F1DB
(CC-BY-4.0) and reports drivers missing from ours. Local only.
Usage: python scripts/audit_results_vs_f1db.py [--version vYYYY.RR.M | --f1db-dir DIR] [--modern-plan]"""
import argparse
import json
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, ".")
sys.path.insert(0, "scripts")

from f1db_release import fetch_release, latest_version
from src.db.client import get_conn
from src.utils.f1db_results import match_f1db_driver

SESSIONS = {
    "race": ("f1db-races-race-results.json", "race_results"),
    "qualifying": ("f1db-races-qualifying-results.json", "qualifying_results"),
    "sprint": ("f1db-races-sprint-race-results.json", "sprint_results"),
}
NOT_ENTERED = {"DNQ", "DNPQ", "EX", "DNP"}
FASTF1_ERA = 2018


def load_f1db(directory: Path) -> tuple[dict, dict]:
    drivers = {d["id"]: d for d in json.loads((directory / "f1db-drivers.json").read_text())}
    by_session: dict[str, dict] = {}
    for session, (filename, _) in SESSIONS.items():
        records = defaultdict(set)
        for r in json.loads((directory / filename).read_text()):
            if session == "race" and r["positionText"] in NOT_ENTERED:
                continue
            records[(r["year"], r["round"])].add(r["driverId"])
        by_session[session] = records
    return drivers, by_session


def audit(directory: Path) -> dict:
    f1_drivers, f1_sessions = load_f1db(directory)
    season_entrants = defaultdict(set)
    for records in f1_sessions.values():
        for (year, _), ids in records.items():
            season_entrants[year] |= ids

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT r.id, s.year, r.round_number FROM races r JOIN seasons s ON s.id = r.season_id "
                        "WHERE r.status = 'completed'")
            races = {r["id"]: (r["year"], r["round_number"]) for r in cur.fetchall()}
            ours = {}
            for session, (_, table) in SESSIONS.items():
                cur.execute(f"SELECT t.race_id, d.first_name, d.last_name FROM {table} t JOIN drivers d ON d.id = t.driver_id")
                rows = defaultdict(list)
                for r in cur.fetchall():
                    rows[r["race_id"]].append(r)
                ours[session] = rows
        conn.rollback()
    finally:
        conn.close()

    missing = defaultdict(dict)
    for race_id, (year, round_number) in races.items():
        candidates = [f1_drivers[i] for i in season_entrants[year]]
        for session in SESSIONS:
            expected = f1_sessions[session].get((year, round_number), set())
            have = set()
            for row in ours[session].get(race_id, []):
                match = match_f1db_driver(row["first_name"], row["last_name"], candidates)
                if match:
                    have.add(match["id"])
            gone = sorted(f1_drivers[i]["name"] for i in expected - have)
            if gone:
                missing[(year, round_number)][session] = gone
    return missing


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", default=None)
    parser.add_argument("--f1db-dir", default=None, help="an already verified, extracted release")
    parser.add_argument("--modern-plan", action="store_true", help=f"print {FASTF1_ERA}+ races to re-ingest as JSON")
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="f1db-") as tmp:
        directory = Path(args.f1db_dir) if args.f1db_dir else fetch_release(args.version or latest_version(), Path(tmp))
        missing = audit(directory)

    if args.modern_plan:
        plan = [{"year": y, "round": r, "sessions": sorted(s)} for (y, r), s in sorted(missing.items()) if y >= FASTF1_ERA]
        print(json.dumps(plan))
        sys.exit(0)

    per_year = defaultdict(lambda: defaultdict(int))
    for (year, _), sessions in missing.items():
        for session, names in sessions.items():
            per_year[year][session] += len(names)
    for year in sorted(per_year):
        print(year, dict(per_year[year]))
    print("TOTAL", {s: sum(y[s] for y in per_year.values()) for s in SESSIONS})
