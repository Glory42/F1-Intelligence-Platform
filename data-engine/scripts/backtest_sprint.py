"""Walk-forward backtest of sprint winner models on the local snapshot (scripts/backtest_snapshot.py), never
Neon. Each sprint is predicted from races before its weekend only, by:
- stored: what driver_sprint_features holds (hand-weighted sprint-v2 until it was replaced by sprint-v3);
- v4 transfer: weighted-v4's GP weights, fitted on earlier GPs, applied to the sprint grid (sprint_features);
- pooled: the same features refitted on earlier GPs and sprints together;
- sprint-only: refitted on earlier sprints alone, once there are MIN_SPRINTS of them;
plus P(win | grid slot) learned from earlier GPs and sprints, and equal chances. Writes nothing.
Usage: python scripts/backtest_sprint.py [--train-from 2010] [--reference NAME]"""
import argparse
import sys
from collections import defaultdict
from typing import Any

sys.path.insert(0, ".")

from scripts.backtest import connect
from src.utils.backtest import GridWinRates, paired_difference, race_metrics, summarize
from src.utils.gp_features_v4 import sprint_features
from src.utils.gp_model_v4 import TrainingRace, eligible, fit, history_start, training_races
from src.utils.race_history import RaceHistory, load_history

MIN_SPRINTS = 10
STORED = "stored"


def sprint_training_races(h: RaceHistory) -> list[TrainingRace]:
    """Every sprint with a winner on its grid sheet, features computed once, oldest first."""
    out = []
    for race_id in sorted(h.sprint_grid, key=lambda r: h.races[r]["race_date"]):
        race = h.races[race_id]
        winner = next((r["driver_id"] for r in h.sprints.get(race_id, []) if r["finish_position"] == 1), None)
        if winner is None:
            continue
        field = sprint_features(h, race_id)
        if winner in field:
            out.append(TrainingRace(race_id, race["race_date"], race["year"], field, winner))
    return out


def stored_sprint_probabilities(conn: Any) -> dict[int, dict[int, float]]:
    with conn.cursor() as cur:
        cur.execute("SELECT race_id, driver_id, win_probability FROM driver_sprint_features")
        stored: dict[int, dict[int, float]] = defaultdict(dict)
        for r in cur.fetchall():
            stored[r["race_id"]][r["driver_id"]] = float(r["win_probability"] or 0)
    return stored


def run(h: RaceHistory, stored: dict[int, dict[int, float]], train_from: int, reference: str = STORED) -> dict[str, Any]:
    gps = training_races(h, from_year=train_from)
    sprints = sprint_training_races(h)
    per_race: dict[str, list] = defaultdict(list)
    grid_rates = GridWinRates()
    events = sorted(
        [(r["race_date"], "gp", r["id"]) for r in h.races.values() if r["status"] == "completed"]
        + [(t.race_date, "sprint", t.race_id) for t in sprints],
        # A weekend's sprint is decided before its GP.
        key=lambda e: (e[0], e[1] == "gp"),
    )
    by_id = {t.race_id: t for t in sprints}
    for day, kind, race_id in events:
        if kind == "gp":
            grid_rates.record((r["grid_position"], r["finish_position"] == 1) for r in h.results.get(race_id, []))
            continue
        target = by_id[race_id]
        earlier_sprints = eligible(sprints, day)
        candidates = {
            "v4 transfer": fit(gps, before=day),
            "pooled": fit(eligible(gps, day) + earlier_sprints),
        }
        if len(earlier_sprints) >= MIN_SPRINTS:
            candidates["sprint-only"] = fit(earlier_sprints)
        grid = {r["driver_id"]: r["grid_position"] for r in h.sprint_grid[race_id]}
        scored = {name: model.probabilities(target.field) for name, model in candidates.items()}
        scored["grid"] = grid_rates.probabilities(grid)
        scored["uniform"] = {d: 1 / len(grid) for d in grid}
        if stored.get(race_id) and sum(stored[race_id].values()) > 0:
            scored[STORED] = stored[race_id]
        for name, probs in scored.items():
            per_race[name].append({"race_id": race_id, "year": target.year, **race_metrics(probs, target.winner)})
        grid_rates.record((g, d == target.winner) for d, g in grid.items())

    # Every candidate is compared on the sprints the stored model scored, so each row sees the same races.
    shared = {r["race_id"] for r in per_race[STORED]}
    log_loss = {n: {r["race_id"]: r["log_loss"] for r in rows if r["race_id"] in shared} for n, rows in per_race.items()}
    return {
        "summary": {n: summarize([r for r in rows if r["race_id"] in shared]) for n, rows in per_race.items()},
        "vs_reference": {n: paired_difference(ll, log_loss[reference]) for n, ll in log_loss.items() if n != reference},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--train-from", type=int, default=2010)
    parser.add_argument("--reference", default=STORED, help="model the others are paired against")
    args = parser.parse_args()
    conn = connect()
    try:
        h = load_history(conn, since=history_start(args.train_from))
        stored = stored_sprint_probabilities(conn)
    finally:
        conn.close()

    out = run(h, stored, args.train_from, args.reference)
    print(f"\n{'model':<14} {'sprints':>7} {'log loss':>9} {'Brier':>7} {'top-1':>7} {'top-3':>7}")
    for name, s in out["summary"].items():
        if s["races"]:
            print(f"{name:<14} {s['races']:>7} {s['log_loss']:>9.4f} {s['brier']:>7.4f} {s['top1']:>7.1%} {s['top3']:>7.1%}")
    print(f"\nLog loss vs {args.reference}, paired per sprint (negative = better; ±2 SE ≈ noise):")
    for name, d in out["vs_reference"].items():
        if d:
            print(f"  {name:<14} {d['mean']:+.4f} ± {2 * d['se']:.4f}  ({d['races']} sprints)")


if __name__ == "__main__":
    main()
