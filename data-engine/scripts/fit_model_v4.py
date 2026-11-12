"""Refits weighted-v4 on every completed GP since 2010 in the local backtest snapshot and writes
src/models/gp_v4.json plus the importances in docs/feature-weights.json (then mirror those into
apps/api common/feature-manifest.ts GP_FEATURE_MANIFEST: its test fails until you do). Run scripts/backtest.py first: only refit with the setup the backtest validated.
--pre-quali fits the forecast before qualifying (PRE_QUALI_FEATURES) into src/models/gp_v4_prequali.json instead.
Local only, never Neon. Usage: python scripts/fit_model_v4.py [--l2 1.0] [--pre-quali]"""
import argparse
import json
import pathlib
import sys

sys.path.insert(0, ".")

from scripts.backtest import connect
from src.utils.gp_features_v4 import GP_V4_FEATURES, PRE_QUALI_FEATURES
from src.utils.gp_model_v4 import (
    DEFAULT_L2, MODEL_PATH, PRE_QUALI_MODEL_PATH, PRE_QUALI_MODEL_VERSION, TRAIN_FROM_YEAR, fit, history_start,
    importance_percentages, save_model, training_races,
)
from src.utils.race_history import load_history

FEATURE_WEIGHTS_JSON = pathlib.Path(__file__).resolve().parents[2] / "docs" / "feature-weights.json"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--l2", type=float, default=DEFAULT_L2)
    parser.add_argument("--pre-quali", action="store_true", help="fit the forecast before qualifying instead")
    args = parser.parse_args()

    conn = connect()
    try:
        history = load_history(conn, since=history_start(TRAIN_FROM_YEAR))
    finally:
        conn.close()

    training = training_races(history)
    last = training[-1].race_date
    trained_on = {"from_year": TRAIN_FROM_YEAR, "to_date": str(last), "races": len(training)}
    if args.pre_quali:
        # The page shows no weights for it, so docs/feature-weights.json stays the GP model's alone.
        model = fit(training, features=PRE_QUALI_FEATURES, l2=args.l2)
        save_model(model, trained_on, args.l2, PRE_QUALI_MODEL_PATH, PRE_QUALI_MODEL_VERSION)
        print(f"Fitted on {len(training)} races ({TRAIN_FROM_YEAR} → {last}), wrote {PRE_QUALI_MODEL_PATH}")
        return
    model = fit(training, l2=args.l2)
    save_model(model, trained_on, args.l2)
    shared = json.loads(FEATURE_WEIGHTS_JSON.read_text())
    importance = importance_percentages(model)
    for f, pct in importance.items():
        shared["gp"][f]["importance"] = pct
    FEATURE_WEIGHTS_JSON.write_text(json.dumps(shared, indent=2, ensure_ascii=False) + "\n")

    print(f"Fitted on {len(training)} races ({TRAIN_FROM_YEAR} → {last}), wrote {MODEL_PATH}")
    for f, c in sorted(zip(GP_V4_FEATURES, model.coef), key=lambda fc: -abs(fc[1])):
        print(f"  {f:<20} {c:+.3f} per SD  ({importance[f]}%)")


if __name__ == "__main__":
    main()
