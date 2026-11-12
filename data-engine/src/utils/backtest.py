"""Scoring for scripts/backtest.py: per-race metrics, a calibration table and the grid-history
baseline. A candidate model only ships if it beats the baselines here on races it never saw."""
import math
from collections import defaultdict
from typing import Hashable, Iterable, Optional

# A winner given 0 would make log loss infinite and swamp every other race in the mean.
_MIN_PROBABILITY = 1e-12


def race_metrics(probabilities: dict[Hashable, float], winner: Hashable) -> dict[str, float]:
    """Log loss and multi-class Brier judge the whole field; top1/top3 are the headline hit rates."""
    p_winner = probabilities.get(winner, 0.0)
    return {
        "log_loss": -math.log(max(p_winner, _MIN_PROBABILITY)),
        "brier": sum((p - (1.0 if d == winner else 0.0)) ** 2 for d, p in probabilities.items()),
        "top1": _top_k_hit(probabilities, p_winner, 1),
        "top3": _top_k_hit(probabilities, p_winner, 3),
    }


def _top_k_hit(probabilities: dict[Hashable, float], p_winner: float, k: int) -> float:
    """Expected hit when ties are broken at random: otherwise a flat model gets credit for
    whichever driver happens to be listed first (the pole-sitter, in grid order)."""
    above = sum(1 for p in probabilities.values() if p > p_winner)
    tied = sum(1 for p in probabilities.values() if p == p_winner)
    return min(max((k - above) / max(tied, 1), 0.0), 1.0)


def place_metrics(probabilities: dict[Hashable, float], placed: set[Hashable]) -> dict[str, float]:
    """Each driver's P(finishing in the top k) against whether they did, as binary log loss and Brier
    averaged over the field: a podium or points forecast is many yes/no calls, unlike the one winner."""
    log_loss = brier = 0.0
    for driver, p in probabilities.items():
        outcome = driver in placed
        p_outcome = p if outcome else 1.0 - p
        log_loss -= math.log(max(p_outcome, _MIN_PROBABILITY))
        brier += (p - (1.0 if outcome else 0.0)) ** 2
    n = max(len(probabilities), 1)
    return {"log_loss": log_loss / n, "brier": brier / n}


def summarize(per_race: list[dict[str, float]]) -> dict[str, float]:
    if not per_race:
        return {"races": 0}
    n = len(per_race)
    return {"races": n, **{k: sum(r[k] for r in per_race) / n for k in ("log_loss", "brier", "top1", "top3")}}


def paired_difference(candidate: dict[Hashable, float], reference: dict[Hashable, float]) -> Optional[dict[str, float]]:
    """Mean per-race difference (candidate − reference) over the races both scored, with its standard
    error: two models share most of their misses, so pairing sees gaps a plain mean can't."""
    shared = [k for k in candidate if k in reference]
    if len(shared) < 2:
        return None
    diffs = [candidate[k] - reference[k] for k in shared]
    mean = sum(diffs) / len(diffs)
    var = sum((d - mean) ** 2 for d in diffs) / (len(diffs) - 1)
    return {"races": len(diffs), "mean": mean, "se": math.sqrt(var / len(diffs))}


DEFAULT_CALIBRATION_EDGES = (0.0, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.7, 1.0)


def calibration_table(
    pairs: Iterable[tuple[float, bool]], edges: tuple[float, ...] = DEFAULT_CALIBRATION_EDGES
) -> list[dict[str, float]]:
    """(predicted p, did that driver win) per driver per race → per-bucket mean p vs actual win rate.
    A calibrated model's two columns match."""
    buckets: dict[int, list[tuple[float, bool]]] = defaultdict(list)
    for p, won in pairs:
        i = next((i for i in range(len(edges) - 1) if p < edges[i + 1]), len(edges) - 2)
        buckets[i].append((p, won))
    return [
        {
            "lo": edges[i],
            "hi": edges[i + 1],
            "n": len(b),
            "mean_p": sum(p for p, _ in b) / len(b),
            "win_rate": sum(1 for _, won in b if won) / len(b),
        }
        for i, b in sorted(buckets.items())
    ]


class GridWinRates:
    """Baseline: P(win | grid slot) learned only from races recorded so far, so a walk-forward
    backtest never sees its own future. Its top pick is the pole-sitter once history exists."""

    BACK_SLOT = 21

    def __init__(self) -> None:
        self._starts: dict[int, int] = defaultdict(int)
        self._wins: dict[int, int] = defaultdict(int)

    def slot(self, grid_position: Optional[int]) -> int:
        if grid_position is None or grid_position <= 0 or grid_position > self.BACK_SLOT:
            return self.BACK_SLOT
        return grid_position

    def record(self, results: Iterable[tuple[Optional[int], bool]]) -> None:
        for grid_position, won in results:
            s = self.slot(grid_position)
            self._starts[s] += 1
            self._wins[s] += int(won)

    def rate(self, grid_position: Optional[int]) -> float:
        # Add-half smoothing keeps a never-won slot possible without inventing much signal.
        s = self.slot(grid_position)
        return (self._wins[s] + 0.5) / (self._starts[s] + 1)

    def probabilities(self, grid: dict[Hashable, Optional[int]]) -> dict[Hashable, float]:
        rate = {d: self.rate(g) for d, g in grid.items()}
        total = sum(rate.values())
        return {d: r / total for d, r in rate.items()}


class GridPlaceRates:
    """Baseline for a top-k forecast: P(finishing in the top `places` | grid slot), learned only from
    races recorded so far. Unlike GridWinRates it isn't normalised: k drivers finish in the top k."""

    def __init__(self, places: int) -> None:
        self.places = places
        self._slots = GridWinRates()

    def record(self, results: Iterable[tuple[Optional[int], Optional[int]]]) -> None:
        self._slots.record((grid, finish is not None and finish <= self.places) for grid, finish in results)

    def probabilities(self, grid: dict[Hashable, Optional[int]]) -> dict[Hashable, float]:
        return {d: self._slots.rate(g) for d, g in grid.items()}
