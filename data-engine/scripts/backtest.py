"""Walk-forward backtest of the GP winner model against the local snapshot (scripts/backtest_snapshot.py),
never Neon. Every race is predicted from races before it only: features come from race_history as of the
race, and each candidate is refit before every test race on earlier races (from --train-from). Writes
nothing. The v3 baseline numbers this replaced are in docs/prediction-model.md § Backtest.
Usage: python scripts/backtest.py [--from 2018] [--to 2026] [--train-from 2010] [--reference NAME] [--json]"""
import argparse
import datetime
import json
import os
import pathlib
import sys
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

import numpy as np
import psycopg2
import psycopg2.extras

sys.path.insert(0, ".")

from src.utils.backtest import GridWinRates, calibration_table, paired_difference, race_metrics, summarize
from src.utils.conditional_logit import fit_conditional_logit
from src.utils.gp_features_v4 import GP_V4_FEATURES, gp_features
from src.utils.race_history import RaceHistory, load_history

BACKTEST_DATABASE_URL = os.environ.get(
    "BACKTEST_DATABASE_URL", "postgresql://f1:f1@localhost:5434/f1_backtest"
)
RESULTS_DIR = pathlib.Path("cache/backtest")

Field = dict[int, dict[str, float]]  # driver_id → named feature values
Probabilities = dict[int, float]


@dataclass(frozen=True)
class Candidate:
    """A conditional logit over a subset of gp_features_v4.CANDIDATE_FEATURES: try a new feature by
    adding a Candidate with it, then compare with --reference weighted-v4."""

    name: str
    features: tuple[str, ...]
    l2: float = 1.0


CANDIDATES: list[Candidate] = [
    Candidate("weighted-v4", GP_V4_FEATURES),
]
# A fitted model needs some history before its first prediction.
MIN_TRAINING_RACES = 20


def connect() -> Any:
    if "neon.tech" in BACKTEST_DATABASE_URL:
        raise SystemExit("Refusing to backtest against Neon: point BACKTEST_DATABASE_URL at the local snapshot.")
    conn = psycopg2.connect(BACKTEST_DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    conn.set_session(readonly=True, autocommit=True)
    return conn


def load(conn: Any, train_from: int) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute("SELECT race_id, driver_id, win_probability FROM driver_prediction_features")
        stored: dict[int, Probabilities] = defaultdict(dict)
        for r in cur.fetchall():
            stored[r["race_id"]][r["driver_id"]] = float(r["win_probability"] or 0)
    # Form features look back up to ~2 seasons, so history starts before the first training race.
    history = load_history(conn, since=datetime.date(train_from - 3, 1, 1))
    return {"history": history, "stored": stored}


def _matrix(field: Field, features: tuple[str, ...]) -> np.ndarray:
    return np.array([[field[d][f] for f in features] for d in field], dtype=float)


def run(
    data: dict[str, Any], years: range, train_from: int, candidates: list[Candidate], reference: str = "grid-history",
) -> dict[str, Any]:
    history: RaceHistory = data["history"]
    per_race: dict[str, list] = defaultdict(list)
    calibration: dict[str, list] = defaultdict(list)
    grid_rates = GridWinRates()
    training: dict[str, list] = defaultdict(list)  # candidate → [(X, winner row)]
    weights: dict[str, Any] = {}

    def score(name: str, race: dict[str, Any], probs: Probabilities, winner: int) -> None:
        per_race[name].append({"race_id": race["id"], "year": race["year"], **race_metrics(probs, winner)})
        calibration[name].extend((p, d == winner) for d, p in probs.items())

    completed = sorted((r for r in history.races.values() if r["status"] == "completed"), key=lambda r: r["race_date"])
    for race in completed:
        results = history.results.get(race["id"], [])
        winner = next((r["driver_id"] for r in results if r["finish_position"] == 1), None)
        grid = {q["driver_id"]: q["grid_position"] for q in history.quali.get(race["id"], [])}
        if race["year"] >= train_from and winner in grid:
            field = gp_features(history, race["id"])
            if race["year"] in years:
                for c in candidates:
                    if len(training[c.name]) >= MIN_TRAINING_RACES:
                        model = fit_conditional_logit(training[c.name], c.features, l2=c.l2)
                        weights[c.name] = model
                        score(c.name, race, model.probabilities(field), winner)
                score("grid-history", race, grid_rates.probabilities(grid), winner)
                score("uniform", race, {d: 1 / len(grid) for d in grid}, winner)
                stored = data["stored"].get(race["id"])
                if stored and sum(stored.values()) > 0:
                    score("stored in DB", race, stored, winner)
            for c in candidates:
                training[c.name].append((_matrix(field, c.features), list(field).index(winner)))
        # Recorded after scoring, so the baseline only ever knows earlier races.
        grid_rates.record((r["grid_position"], r["finish_position"] == 1) for r in results)

    log_loss = {name: {r["race_id"]: r["log_loss"] for r in rows} for name, rows in per_race.items()}
    return {
        "summary": {name: summarize(rows) for name, rows in per_race.items()},
        "vs_reference": {
            "reference": reference,
            **{name: paired_difference(ll, log_loss[reference]) for name, ll in log_loss.items() if name != reference},
        },
        "by_year": {
            name: {y: summarize([r for r in rows if r["year"] == y]) for y in sorted({r["year"] for r in rows})}
            for name, rows in per_race.items()
        },
        "calibration": {name: calibration_table(pairs) for name, pairs in calibration.items()},
        "weights": {
            name: {f: round(float(c), 3) for f, c in zip(m.features, m.coef)} for name, m in weights.items()
        },
    }


def report(out: dict[str, Any], candidates: list[Candidate]) -> None:
    print(f"\n{'model':<20} {'races':>5} {'log loss':>9} {'Brier':>7} {'top-1':>7} {'top-3':>7}")
    for name, s in out["summary"].items():
        if s["races"]:
            print(f"{name:<20} {s['races']:>5} {s['log_loss']:>9.4f} {s['brier']:>7.4f} "
                  f"{s['top1']:>7.1%} {s['top3']:>7.1%}")

    ref = out["vs_reference"]["reference"]
    print(f"\nLog loss vs {ref}, paired per race (negative = better; ±2 SE ≈ noise):")
    for name, d in out["vs_reference"].items():
        if name != "reference" and d:
            print(f"  {name:<28} {d['mean']:+.4f} ± {2 * d['se']:.4f}")

    print("\nBy season (log loss / top-1):")
    names = list(out["by_year"])
    years = sorted({y for by in out["by_year"].values() for y in by})
    print(f"{'year':<6}" + "".join(f"{n[:18]:>22}" for n in names))
    for y in years:
        cells = []
        for n in names:
            s = out["by_year"][n].get(y)
            cells.append(f"{s['log_loss']:.3f} / {s['top1']:.0%}" if s else "-")
        print(f"{y:<6}" + "".join(f"{c:>22}" for c in cells))

    for name, coef in out["weights"].items():
        print(f"\nLast fitted weights, {name} (per standard deviation):")
        for f, c in sorted(coef.items(), key=lambda kv: -abs(kv[1])):
            print(f"  {f:<28} {c:+.3f}")

    for name in [c.name for c in candidates]:
        print(f"\nCalibration, {name} (predicted p vs actual win rate):")
        for b in out["calibration"].get(name, []):
            print(f"  [{b['lo']:.2f}, {b['hi']:.2f})  n={b['n']:>5}  mean p={b['mean_p']:.3f}  won={b['win_rate']:.3f}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--from", dest="start", type=int, default=2018)
    parser.add_argument("--to", dest="end", type=int, default=datetime.date.today().year)
    parser.add_argument("--train-from", type=int, default=2010)
    parser.add_argument("--reference", default="grid-history", help="model the others are paired against")
    parser.add_argument("--json", action="store_true", help="also save the full result under cache/backtest/")
    args = parser.parse_args()

    conn = connect()
    try:
        data = load(conn, args.train_from)
    finally:
        conn.close()

    out = run(data, range(args.start, args.end + 1), args.train_from, CANDIDATES, args.reference)
    report(out, CANDIDATES)
    if args.json:
        RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        path = RESULTS_DIR / f"results-{datetime.datetime.now():%Y%m%d-%H%M}.json"
        path.write_text(json.dumps(out, indent=2, default=str))
        print(f"\nSaved {path}")


if __name__ == "__main__":
    main()
