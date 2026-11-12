"""A whole finishing order from a field's win probabilities: Plackett–Luce draws turned into each driver's
chance of every place, then P(podium), P(points) and expected points. Seeded per race, so a rerun writes
the same numbers (ETL rule 5)."""
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

import numpy as np

PODIUM_PLACES = 3
SAMPLES = 20_000
# The Henery exponent scripts/backtest.py --places validated (2018–2026, 190 GPs): plain Plackett–Luce (1.0)
# overrates favourites' podiums; 0.8 beats the grid baseline. P(points) beat it at no exponent, so isn't served.
PODIUM_DISCOUNT = 0.8


@dataclass(frozen=True)
class FinishingOrderForecast:
    podium: np.ndarray
    points_finish: np.ndarray
    expected_points: np.ndarray


def place_probabilities(win_probs: np.ndarray, n: int, rng: np.random.Generator, discount: float = 1.0) -> np.ndarray:
    """(drivers, places) matrix of P(driver finishes in that place). The winner is drawn from win_probs;
    the rest of the order from win_probs ** discount (Henery): below 1 it flattens the places after the
    win, where plain Plackett–Luce is overconfident for the favourites. Gumbel-max keeps it one argsort."""
    if discount <= 0:
        raise ValueError("discount must be positive")
    drivers = len(win_probs)
    with np.errstate(divide="ignore"):
        log_p = np.log(win_probs)
    winners = np.argmax(log_p + rng.gumbel(size=(n, drivers)), axis=1)
    rest = discount * log_p + rng.gumbel(size=(n, drivers))
    rest[np.arange(n), winners] = np.inf
    orders = np.argsort(-rest, axis=1)
    counts = np.zeros((drivers, drivers))
    np.add.at(counts, (orders.ravel(), np.tile(np.arange(drivers), n)), 1)
    return counts / n


def finishing_order_forecast(
    win_probs: np.ndarray,
    points: tuple[int, ...],
    seed: int,
    n: int = SAMPLES,
    discount: float = 1.0,
    podium_places: int = PODIUM_PLACES,
) -> FinishingOrderForecast:
    places = place_probabilities(win_probs, n, np.random.default_rng(seed), discount)
    scoring = min(len(points), places.shape[1])
    return FinishingOrderForecast(
        podium=places[:, :podium_places].sum(axis=1),
        points_finish=places[:, :scoring].sum(axis=1),
        expected_points=places[:, :scoring] @ np.array(points[:scoring], dtype=float),
    )


def podium_probabilities(win_probs: np.ndarray, seed: int) -> np.ndarray:
    return finishing_order_forecast(win_probs, (), seed, discount=PODIUM_DISCOUNT).podium


def podium_updates(stored: list[dict[str, Any]]) -> list[tuple[float, int, int]]:
    """(podium_probability, race_id, driver_id) for stored GP predictions. Each field is ordered by predicted
    position, as compute_features passes it, so the per-race seed gives the numbers a rerun would write."""
    fields: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in stored:
        fields[row["race_id"]].append(row)
    updates = []
    for race_id, rows in fields.items():
        rows.sort(key=lambda r: (r["predicted_position"] is None, r["predicted_position"] or 0, r["driver_id"]))
        podium = podium_probabilities(np.array([float(r["win_probability"]) for r in rows]), seed=race_id)
        updates.extend((round(float(p), 5), race_id, r["driver_id"]) for p, r in zip(podium, rows))
    return updates
