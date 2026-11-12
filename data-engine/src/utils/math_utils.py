import numpy as np


def normalize_minmax(values: list[float], default: float = 0.5) -> list[float]:
    arr = np.array(values, dtype=float)
    mn, mx = arr.min(), arr.max()
    if mx == mn:
        return [default] * len(values)
    return ((arr - mn) / (mx - mn)).tolist()


def bayesian_win_rate(wins: int | float, races: int | float) -> float:
    return (wins + 0.5) / (races + 2)


def clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))
