import numpy as np


def normalize_minmax(values: list[float], default: float = 0.5) -> list[float]:
    arr = np.array(values, dtype=float)
    mn, mx = arr.min(), arr.max()
    if mx == mn:
        return [default] * len(values)
    return ((arr - mn) / (mx - mn)).tolist()


def softmax(scores: list[float], temperature: float = 1.0) -> list[float]:
    arr = np.array(scores, dtype=float)
    shifted = arr - arr.max()
    exp_s = np.exp(shifted / temperature)
    return (exp_s / exp_s.sum()).tolist()


def bayesian_win_rate(wins: int | float, races: int | float) -> float:
    return (wins + 0.5) / (races + 2)


def clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


def weighted_sum(scores: dict[str, float], weights: dict[str, float]) -> float:
    """Dot product of per-feature scores against a model's WEIGHTS dict, keyed by feature
    name. Shared by the GP and sprint models: same combination rule, different weights."""
    return sum(scores[feature] * weight for feature, weight in weights.items())
