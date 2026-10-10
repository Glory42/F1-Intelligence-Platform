"""Candidate weighted-v4 inputs, evaluated by scripts/backtest_model_v4.py before any rollout."""

from src.utils.feature_helpers import circuit_adj_start_pos
from src.utils.feature_manifest import GP_WEIGHTS, SOFTMAX_TEMPERATURE
from src.utils.math_utils import clamp, softmax


def shrink_toward_prior(measured: float, prior: float, n: int, k: float = 2.0) -> float:
    """Empirical-Bayes blend: with few measured races at a circuit, trust the seeded rate."""
    if n == 0:
        return prior
    weight = n / (n + k)
    return weight * measured + (1 - weight) * prior


def measured_overtake_rates(samples: list[dict], before) -> dict[int, tuple[float, int]]:
    """circuit_id → (percentile rank of mean passes per car-lap among circuits, races measured).
    Only races strictly before `before` count, so a backtest never sees its own future. Rank, not
    raw rate, keeps the scale comparable to the seeded 0–1 circuits.overtake_rate."""
    per_circuit: dict[int, list[float]] = {}
    for s in samples:
        if s["date"] < before and s["car_laps"] > 0:
            per_circuit.setdefault(s["circuit_id"], []).append(s["passes"] / s["car_laps"])
    means = {c: sum(v) / len(v) for c, v in per_circuit.items()}
    ordered = sorted(means, key=means.get)
    span = max(len(ordered) - 1, 1)
    return {c: (i / span, len(per_circuit[c])) for i, c in enumerate(ordered)}


def brier_score(probabilities: dict, winner) -> float:
    """Multi-class Brier over every driver (lower is better). The recap page shows a binary Brier on
    the predicted winner only; the backtest uses this stricter one because it judges the whole field."""
    return sum((p - (1.0 if driver == winner else 0.0)) ** 2 for driver, p in probabilities.items())


def rescore_with_overtake_rate(rows: list[dict], overtake_rate: float, sc_probability: float) -> dict:
    """Re-prices stored GP feature rows under a different overtake rate. Only the two circuit-adjusted
    features depend on it, so each raw score shifts by weight × (new − old) — exact, no recompute."""
    weights = GP_WEIGHTS
    raws = []
    for r in rows:
        new_start = circuit_adj_start_pos(float(r["starting_position_score"]), overtake_rate, sc_probability)
        new_gain = clamp(float(r["position_gain_score"]) * overtake_rate)
        raws.append(
            float(r["raw_weighted_score"])
            + weights["circuit_adj_start_pos"] * (new_start - float(r["circuit_adj_start_pos_score"]))
            + weights["circuit_adj_position_gain"] * (new_gain - float(r["circuit_adj_position_gain_score"]))
        )
    probs = softmax(raws, temperature=SOFTMAX_TEMPERATURE)
    return {r["driver_id"]: float(p) for r, p in zip(rows, probs)}
