"""weighted-v4's fitted weights: written by scripts/fit_model_v4.py from the local backtest snapshot, committed
with the code (reviewable, versioned like v3's hand weights) and read by the live feature job."""
import json
from datetime import date
from pathlib import Path
from typing import Any, Optional

import numpy as np

from src.utils.conditional_logit import LogitModel, Race
from src.utils.gp_features_v4 import GP_V4_FEATURES, gp_features
from src.utils.race_history import RaceHistory

GP_V4_MODEL_VERSION = "weighted-v4"
MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "gp_v4.json"
# The 2010+ points table: older eras score finishes differently, so form features start here.
TRAIN_FROM_YEAR = 2010


def training_set(history: RaceHistory, before: Optional[date] = None) -> list[Race]:
    """Every completed GP from TRAIN_FROM_YEAR (and before `before`) with a winner on its qualifying
    sheet, as (feature matrix, winner row), oldest first."""
    races = sorted(
        (r for r in history.races.values()
         if r["status"] == "completed" and r["year"] >= TRAIN_FROM_YEAR and (before is None or r["race_date"] < before)),
        key=lambda r: r["race_date"],
    )
    out = []
    for race in races:
        winner = next((r["driver_id"] for r in history.results.get(race["id"], []) if r["finish_position"] == 1), None)
        if winner is None or not history.quali.get(race["id"]):
            continue
        field = gp_features(history, race["id"])
        if winner in field:
            out.append((np.array([[field[d][f] for f in GP_V4_FEATURES] for d in field]), list(field).index(winner)))
    return out


def importance_percentages(model: LogitModel) -> dict[str, int]:
    """Each feature's share of the summed |weight per SD|, as whole percentages that add up to 100
    (largest remainder): what the prediction page shows as the model's weights."""
    total = sum(abs(c) for c in model.coef)
    raw = {f: abs(c) / total * 100 for f, c in zip(model.features, model.coef)}
    out = {f: int(v) for f, v in raw.items()}
    for f in sorted(raw, key=lambda f: out[f] - raw[f])[: 100 - sum(out.values())]:
        out[f] += 1
    return out


def save_model(model: LogitModel, trained_on: dict[str, Any], l2: float, path: Path = MODEL_PATH) -> None:
    payload = {
        "model_version": GP_V4_MODEL_VERSION,
        "l2": l2,
        "trained_on": trained_on,
        "features": [
            {"name": f, "mean": float(m), "scale": float(s), "coef": float(c)}
            for f, m, s, c in zip(model.features, model.mean, model.scale, model.coef)
        ],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def load_model(path: Path = MODEL_PATH) -> LogitModel:
    """Refuses a file fitted for a different feature list, so a feature added to the code without a
    refit fails loudly instead of being scored with a missing or misplaced weight."""
    payload = json.loads(path.read_text())
    features = tuple(f["name"] for f in payload["features"])
    if features != GP_V4_FEATURES:
        raise ValueError(f"{path.name} was fitted for {features}, the code computes {GP_V4_FEATURES}: refit it")
    return LogitModel(
        features=features,
        mean=np.array([f["mean"] for f in payload["features"]]),
        scale=np.array([f["scale"] for f in payload["features"]]),
        coef=np.array([f["coef"] for f in payload["features"]]),
    )
