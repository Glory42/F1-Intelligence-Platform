"""Read-only backtest: does a measured circuit overtake rate (from race_overtakes, shrunk toward the
seeded circuits.overtake_rate) predict GP winners better than the seeded rate alone? Re-prices every
stored weighted-v3 prediction and compares mean multi-class Brier and winner hit rate. Writes nothing.
Usage: python scripts/backtest_model_v4.py [--k 2]"""
import argparse
import sys
from collections import defaultdict

sys.path.insert(0, ".")

from src.db.client import get_conn
from src.utils.model_v4 import brier_score, measured_overtake_rates, rescore_with_overtake_rate, shrink_toward_prior

FEATURE_COLUMNS = (
    "raw_weighted_score", "starting_position_score", "position_gain_score",
    "circuit_adj_start_pos_score", "circuit_adj_position_gain_score",
)


def load(conn):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT f.race_id, f.driver_id, " + ", ".join(f"f.{c}" for c in FEATURE_COLUMNS) + ", "
            "r.race_date, r.circuit_id, c.overtake_rate, c.sc_probability "
            "FROM driver_prediction_features f JOIN races r ON r.id = f.race_id JOIN circuits c ON c.id = r.circuit_id "
            "WHERE r.status = 'completed' AND f.circuit_adj_start_pos_score IS NOT NULL"
        )
        features = cur.fetchall()
        cur.execute("SELECT race_id, driver_id FROM race_results WHERE finish_position = 1")
        winners = {r["race_id"]: r["driver_id"] for r in cur.fetchall()}
        cur.execute(
            "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'race_overtakes' AND column_name = 'session_type') AS has_session"
        )
        # Before migration 0020 sprint passes can't be told apart, so they're counted too.
        session_filter = " AND o.session_type = 'race'" if cur.fetchone()["has_session"] else ""
        cur.execute(
            "SELECT r.circuit_id, r.race_date AS date, count(o.id) AS passes, "
            "COALESCE(c.lap_count, 0) * 20 AS car_laps "
            "FROM races r JOIN circuits c ON c.id = r.circuit_id "
            f"JOIN race_overtakes o ON o.race_id = r.id{session_filter} "
            "GROUP BY r.id, r.circuit_id, r.race_date, c.lap_count"
        )
        samples = [dict(r) for r in cur.fetchall()]
    return features, winners, samples


def evaluate(features, winners, samples, k: float) -> dict:
    races = defaultdict(list)
    for row in features:
        races[row["race_id"]].append(row)

    totals = {"v3": {"brier": 0.0, "hits": 0}, "v4": {"brier": 0.0, "hits": 0}, "races": 0}
    for race_id, rows in races.items():
        winner = winners.get(race_id)
        if winner is None:
            continue
        meta = rows[0]
        prior = float(meta["overtake_rate"] or 0.5)
        sc = float(meta["sc_probability"] or 0.3)
        measured, n = measured_overtake_rates(samples, before=meta["race_date"]).get(meta["circuit_id"], (prior, 0))
        candidates = {
            "v3": rescore_with_overtake_rate(rows, prior, sc),
            "v4": rescore_with_overtake_rate(rows, shrink_toward_prior(measured, prior, n, k), sc),
        }
        totals["races"] += 1
        for name, probs in candidates.items():
            totals[name]["brier"] += brier_score(probs, winner)
            totals[name]["hits"] += int(max(probs, key=probs.get) == winner)
    return totals


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--k", type=float, default=2.0, help="shrinkage strength (races of prior weight)")
    args = parser.parse_args()

    conn = get_conn()
    try:
        conn.rollback()  # get_conn's liveness probe opened a transaction; set_session needs none
        conn.set_session(readonly=True)
        features, winners, samples = load(conn)
    finally:
        conn.close()

    totals = evaluate(features, winners, samples, args.k)
    n = max(totals["races"], 1)
    print(f"Races backtested: {totals['races']}  (k={args.k})")
    for name in ("v3", "v4"):
        print(f"  {name}: mean Brier {totals[name]['brier'] / n:.4f}   winner hit rate {totals[name]['hits'] / n:.1%}")
