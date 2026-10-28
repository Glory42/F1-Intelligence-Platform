"""weighted-v4, the GP winner model: the only place that turns "races before X" into fitted weights and
win probabilities. The live feature job, the backfill, the fit script and the backtest all go through
`training_races` → `fit` → `predict`, so the leak-free rule for weights is the one `before` filter in `fit`.
The committed fit (src/models/gp_v4.json) is written by scripts/fit_model_v4.py and reviewed like code."""
import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Optional, Sequence

import numpy as np

from src.utils.conditional_logit import LogitModel, fit_conditional_logit
from src.utils.gp_features_v4 import GP_V4_FEATURES, gp_features
from src.utils.race_history import RaceHistory

GP_V4_MODEL_VERSION = "weighted-v4"
MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "gp_v4.json"
# The 2010+ points table: older eras score finishes differently, so form features start here.
TRAIN_FROM_YEAR = 2010
DEFAULT_L2 = 1.0
# Form looks back up to 40 races and the circuit safety-car rate further: three seasons covers both.
HISTORY_SEASONS = 3

Field = dict[int, dict[str, float]]  # driver_id → named feature values


def history_start(first_year: int) -> date:
    """Where to start loading history so features for races from `first_year` on see their full lookback."""
    return date(first_year - HISTORY_SEASONS, 1, 1)


@dataclass(frozen=True)
class TrainingRace:
    race_id: int
    race_date: date
    year: int
    field: Field
    winner: int  # driver_id

    def matrix(self, features: tuple[str, ...]) -> np.ndarray:
        return np.array([[self.field[d][f] for f in features] for d in self.field], dtype=float)


def training_races(history: RaceHistory, from_year: int = TRAIN_FROM_YEAR) -> list[TrainingRace]:
    """Every completed GP from `from_year` whose winner is on its qualifying sheet, with its field's
    features computed once, oldest first. Callers narrow it with `fit(..., before=)`."""
    races = sorted(
        (r for r in history.races.values() if r["status"] == "completed" and r["year"] >= from_year),
        key=lambda r: r["race_date"],
    )
    out = []
    for race in races:
        winner = next((r["driver_id"] for r in history.results.get(race["id"], []) if r["finish_position"] == 1), None)
        if winner is None or not history.quali.get(race["id"]):
            continue
        field = gp_features(history, race["id"])
        if winner in field:
            out.append(TrainingRace(race["id"], race["race_date"], race["year"], field, winner))
    return out


def eligible(training: Sequence[TrainingRace], before: Optional[date]) -> list[TrainingRace]:
    return [t for t in training if before is None or t.race_date < before]


def fit(
    training: Sequence[TrainingRace],
    *,
    before: Optional[date] = None,
    features: tuple[str, ...] = GP_V4_FEATURES,
    l2: float = DEFAULT_L2,
) -> LogitModel:
    """Weights fitted only on races dated before `before` (all of them when None)."""
    races = eligible(training, before)
    if not races:
        raise ValueError(f"No completed GPs to fit on before {before}")
    return fit_conditional_logit(
        [(t.matrix(features), list(t.field).index(t.winner)) for t in races], features, l2=l2
    )


@dataclass(frozen=True)
class DriverPrediction:
    driver_id: int
    values: dict[str, float]
    contributions: dict[str, float]
    probability: float
    position: int

    @property
    def score(self) -> float:
        return sum(self.contributions.values())


def predict(history: RaceHistory, race_id: int, model: LogitModel) -> list[DriverPrediction]:
    """Every driver on the race's qualifying sheet, most likely winner first."""
    field = gp_features(history, race_id)
    probabilities = model.probabilities(field)
    ranked = sorted(field, key=lambda d: probabilities[d], reverse=True)
    return [
        DriverPrediction(
            driver_id=d,
            values={f: field[d][f] for f in model.features},
            contributions=model.contributions(field[d]),
            probability=probabilities[d],
            position=i + 1,
        )
        for i, d in enumerate(ranked)
    ]


def importance_percentages(model: LogitModel) -> dict[str, int]:
    """Each feature's share of the summed |weight per SD|, as whole percentages that add up to 100
    (largest remainder): what the prediction page shows as the model's weights."""
    total = sum(abs(c) for c in model.coef)
    raw = {f: abs(c) / total * 100 for f, c in zip(model.features, model.coef)}
    out = {f: int(v) for f, v in raw.items()}
    for f in sorted(raw, key=lambda f: out[f] - raw[f])[: 100 - sum(out.values())]:
        out[f] += 1
    return out


@dataclass(frozen=True)
class CommittedFit:
    model: LogitModel
    l2: float
    # The last race the committed weights were fitted on: predicting it or anything earlier is in-sample.
    trained_to: date

    def is_in_sample(self, race_date: date) -> bool:
        return race_date <= self.trained_to


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


def load_committed(path: Path = MODEL_PATH) -> CommittedFit:
    """Refuses a file fitted for a different feature list or model version, so a feature added to the
    code without a refit fails loudly instead of being scored with a missing or misplaced weight."""
    payload = json.loads(path.read_text())
    if payload.get("model_version") != GP_V4_MODEL_VERSION:
        raise ValueError(f"{path.name} holds {payload.get('model_version')}, the code is {GP_V4_MODEL_VERSION}")
    features = tuple(f["name"] for f in payload["features"])
    if features != GP_V4_FEATURES:
        raise ValueError(f"{path.name} was fitted for {features}, the code computes {GP_V4_FEATURES}: refit it")
    model = LogitModel(
        features=features,
        mean=np.array([f["mean"] for f in payload["features"]]),
        scale=np.array([f["scale"] for f in payload["features"]]),
        coef=np.array([f["coef"] for f in payload["features"]]),
    )
    return CommittedFit(model, float(payload["l2"]), date.fromisoformat(payload["trained_on"]["to_date"]))
