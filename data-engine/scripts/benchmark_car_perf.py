"""Benchmarks the car_performance_score formula change (old avg-finish vs new blended)
by recomputing predictions under both, then restores all touched DB state afterward."""
import argparse
import pathlib
import sys

import psycopg2
import psycopg2.extras

sys.path.insert(0, ".")

from src.config import DATABASE_URL
from src.jobs import compute_season_stats, compute_features, compute_predictions


def connect():
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    conn.autocommit = True
    return conn


def load_completed_races(conn, years):
    cur = conn.cursor()
    cur.execute(
        """
        SELECT r.id, s.year, r.round_number, r.race_date
        FROM races r JOIN seasons s ON r.season_id = s.id
        WHERE r.status = 'completed' AND s.year = ANY(%s)
        ORDER BY s.year, r.race_date, r.round_number
        """,
        (years,),
    )
    races = list(cur.fetchall())
    cur.close()
    return races


def actual_winner_map(conn, race_ids):
    """race_id -> driver code of the actual (finish_position=1) winner."""
    cur = conn.cursor()
    cur.execute(
        """
        SELECT rr.race_id, d.code
        FROM race_results rr JOIN drivers d ON rr.driver_id = d.id
        WHERE rr.race_id = ANY(%s) AND rr.finish_position = 1
        """,
        (list(race_ids),),
    )
    m = {r["race_id"]: r["code"] for r in cur.fetchall()}
    cur.close()
    return m


def snapshot_old_predictions(conn, race_ids):
    """Stored race_predictions predicted winner code, before any recompute."""
    cur = conn.cursor()
    cur.execute(
        """
        SELECT rp.race_id, d.code
        FROM race_predictions rp JOIN drivers d ON rp.predicted_winner_id = d.id
        WHERE rp.race_id = ANY(%s)
        """,
        (list(race_ids),),
    )
    m = {r["race_id"]: r["code"] for r in cur.fetchall()}
    cur.close()
    return m


def snapshot_state(conn):
    cur = conn.cursor()
    cur.execute("SELECT team_id, car_performance_score FROM team_season_stats")
    tss = {r["team_id"]: r["car_performance_score"] for r in cur.fetchall()}
    cur.execute("SELECT circuit_key, track_category FROM circuits")
    cats = {r["circuit_key"]: r["track_category"] for r in cur.fetchall()}
    cur.execute("SELECT * FROM driver_prediction_features")
    feats = cur.fetchall()
    cur.execute("SELECT race_id, predicted_winner_id, computed_at, model_version FROM race_predictions")
    preds = list(cur.fetchall())
    cur.close()
    cols = [c for c in feats[0].keys()] if feats else []
    return {"tss": tss, "cats": cats, "feats": feats, "feat_cols": cols, "preds": preds}


def restore_state(conn, snap):
    cur = conn.cursor()
    for team_id, score in snap["tss"].items():
        cur.execute("UPDATE team_season_stats SET car_performance_score = %s WHERE team_id = %s", (score, team_id))
    for ck, cat in snap["cats"].items():
        cur.execute("UPDATE circuits SET track_category = %s WHERE circuit_key = %s", (cat, ck))
    cur.execute("DELETE FROM driver_prediction_features")
    cur.execute("DELETE FROM race_predictions")
    cols = snap.get("feat_cols") or []
    if cols and snap["feats"]:
        insert_cols = ",".join(f'"{c}"' for c in cols)
        placeholders = ",".join(["%s"] * len(cols))
        cur.executemany(
            f"INSERT INTO driver_prediction_features ({insert_cols}) VALUES ({placeholders})",
            [[f[c] for c in cols] for f in snap["feats"]],
        )
    cur.executemany(
        "INSERT INTO race_predictions (race_id, predicted_winner_id, computed_at, model_version) VALUES (%s,%s,%s,%s)",
        [(p["race_id"], p["predicted_winner_id"], p["computed_at"], p["model_version"]) for p in snap["preds"]],
    )
    cur.close()


def set_old_car_performance(conn, years):
    """Replicate the PREVIOUS formula: car_perf = minmax(21 - AVG(finish)) per season."""
    cur = conn.cursor()
    for year in years:
        cur.execute(
            """
            WITH agg AS (
                SELECT t.id AS team_id,
                       AVG(rr.finish_position) FILTER (WHERE rr.finish_position IS NOT NULL) AS avg_finish
                FROM teams t
                JOIN drivers d ON d.team_id = t.id AND d.season_id = t.season_id
                JOIN seasons s ON t.season_id = s.id AND s.year = %(year)s
                JOIN races r ON r.season_id = s.id AND r.status = 'completed'
                JOIN race_results rr ON rr.race_id = r.id AND rr.driver_id = d.id
                GROUP BY t.id
            ),
            signals AS (
                SELECT team_id, 21.0 - COALESCE(avg_finish, 21.0) AS sig FROM agg
            ),
            norm AS (
                SELECT team_id, sig,
                       (sig - MIN(sig) OVER ()) / NULLIF(MAX(sig) OVER () - MIN(sig) OVER (), 0) AS sc
                FROM signals
            )
            UPDATE team_season_stats tss
            SET car_performance_score = ROUND(norm.sc, 5)
            FROM norm WHERE norm.team_id = tss.team_id
            """,
            {"year": year},
        )
    cur.close()


def run_prediction(conn, race_id):
    compute_features.run(race_id)
    compute_predictions.run(race_id)
    cur = conn.cursor()
    cur.execute(
        "SELECT d.code FROM race_predictions rp JOIN drivers d ON rp.predicted_winner_id = d.id WHERE rp.race_id = %s",
        (race_id,),
    )
    row = cur.fetchone()
    cur.close()
    return row["code"] if row else None


def accuracy(pred_map, actual_map, race_ids):
    hits = sum(1 for rid in race_ids if pred_map.get(rid) == actual_map.get(rid))
    return hits, len(race_ids)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", nargs="+", type=int, default=None)
    args = ap.parse_args()

    conn = connect()
    cur = conn.cursor()
    cur.execute("SELECT MIN(year) AS mn, MAX(year) AS mx FROM seasons")
    rng = cur.fetchone()
    cur.close()
    years = args.years or list(range(max(2018, rng["mn"]), rng["mx"] + 1))

    races = load_completed_races(conn, years)
    race_ids = [r["id"] for r in races]
    if not race_ids:
        print("No completed races in range")
        conn.close()
        return

    actual = actual_winner_map(conn, race_ids)
    stored_live = snapshot_old_predictions(conn, race_ids)
    snap = snapshot_state(conn)

    print(f"Benchmarking {len(race_ids)} completed races across years {years}\n")

    # OLD recompute: new season-stats code, old avg-finish car_performance formula,
    # no circuit blend: isolates exactly the metric change vs the NEW pass below.
    for year in years:
        compute_season_stats.run(year)
    set_old_car_performance(conn, years)
    conn.cursor().execute("UPDATE circuits SET track_category = NULL")
    old_pred = {}
    for i, race in enumerate(races, 1):
        try:
            old_pred[race["id"]] = run_prediction(conn, race["id"])
        except Exception as exc:
            print(f"  [old] race {race['id']} FAILED: {exc}")
        sys.stdout.write(f"\r  old recompute {i}/{len(races)}")
    print()

    # ── Pass: NEW recompute (restore new season formula + categories) ──────
    for year in years:
        compute_season_stats.run(year)
    cur = conn.cursor()
    for ck, cat in snap["cats"].items():
        cur.execute("UPDATE circuits SET track_category = %s WHERE circuit_key = %s", (cat, ck))
    cur.close()
    new_pred = {}
    for i, race in enumerate(races, 1):
        try:
            new_pred[race["id"]] = run_prediction(conn, race["id"])
        except Exception as exc:
            print(f"  [new] race {race['id']} FAILED: {exc}")
        sys.stdout.write(f"\r  new recompute {i}/{len(races)}")
    print()

    # ── Restore DB to the stored state ─────────────────────────────────────
    try:
        restore_state(conn, snap)
    finally:
        conn.close()

    # ── Report ─────────────────────────────────────────────────────────────
    def rate(m, ids):
        h, n = accuracy(m, actual, ids)
        return h, n, (h / n * 100 if n else 0)

    live_h, live_n, live_pct = rate(stored_live, race_ids)
    old_h, old_n, old_pct = rate(old_pred, race_ids)
    new_h, new_n, new_pct = rate(new_pred, race_ids)

    print("\n" + "=" * 66)
    print("  Model  accuracy (predicted winner == actual winner)")
    print("=" * 66)
    print(f"  STORED LIVE   (point-in-time, old code): {live_h}/{live_n} = {live_pct:.1f}%")
    print(f"  OLD RECOMPUTE (full-season, old formula): {old_h}/{old_n} = {old_pct:.1f}%")
    print(f"  NEW RECOMPUTE (full-season, B+C):          {new_h}/{new_n} = {new_pct:.1f}%")
    print("=" * 66)
    print(f"  Δ NEW vs OLD recompute: {new_h - old_h:+d} hits ({new_pct - old_pct:+.1f}pp)")
    print(f"  Δ NEW vs LIVE:          {new_h - live_h:+d} hits ({new_pct - live_pct:+.1f}pp)")
    print()

    for year in years:
        rs = [r for r in races if r["year"] == year]
        ids = [r["id"] for r in rs]
        _, lp_n, lp = rate({k: v for k, v in stored_live.items() if k in ids}, ids)
        _, op_n, op = rate({k: v for k, v in old_pred.items() if k in ids}, ids)
        _, np_n, np_ = rate({k: v for k, v in new_pred.items() if k in ids}, ids)
        print(f"  {year}: live {lp:5.1f}% ({lp_n}) | old {op:5.1f}% ({op_n}) | new {np_:5.1f}% ({np_n})")

    print("\nPer-race OLD vs NEW differences:")
    for race in races:
        rid = race["id"]
        o = old_pred.get(rid)
        n = new_pred.get(rid)
        a = actual.get(rid)
        if o != n:
            mark = "✔" if n == a else "✘"
            print(f"  {race['year']} R{race['round_number']:>2}: old={o} new={n} actual={a} {mark}")


if __name__ == "__main__":
    main()