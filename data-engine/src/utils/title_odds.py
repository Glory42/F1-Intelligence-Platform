from dataclasses import dataclass

import numpy as np


def sample_finishing_orders(win_probs: np.ndarray, n: int, rng: np.random.Generator) -> np.ndarray:
    """Plackett–Luce draws via the Gumbel-max trick: sorting log(p) + Gumbel noise yields a
    full finishing order whose winner follows p — one vectorised argsort, cheap at Render's 0.1 CPU.
    Returns (n, drivers) indices, best finisher first."""
    with np.errstate(divide="ignore"):
        log_p = np.log(win_probs)
    keys = log_p + rng.gumbel(size=(n, len(win_probs)))
    return np.argsort(-keys, axis=1)


GP_POINTS = (25, 18, 15, 12, 10, 8, 6, 4, 2, 1)
SPRINT_POINTS = (8, 7, 6, 5, 4, 3, 2, 1)


@dataclass(frozen=True)
class RemainingRace:
    win_probs: np.ndarray
    points: tuple[int, ...]


@dataclass(frozen=True)
class TitleOdds:
    title_probability: np.ndarray
    expected_points: np.ndarray
    points_p10: np.ndarray
    points_p90: np.ndarray


def simulate_season_totals(current_points: np.ndarray, races: list[RemainingRace], n: int, seed: int) -> np.ndarray:
    """(n, drivers) final points tallies, one row per simulated season."""
    rng = np.random.default_rng(seed)
    drivers = len(current_points)
    totals = np.tile(current_points.astype(float), (n, 1))
    for race in races:
        orders = sample_finishing_orders(race.win_probs, n, rng)
        award = np.zeros(drivers)
        award[: min(len(race.points), drivers)] = race.points[:drivers]
        np.add.at(totals, (np.arange(n)[:, None], orders), award)
    return totals


def summarize_totals(totals: np.ndarray) -> TitleOdds:
    best = totals.max(axis=1, keepdims=True)
    is_champion = totals == best
    # A points tie is settled on countback, which isn't simulated — split the title between them.
    title_share = is_champion / is_champion.sum(axis=1, keepdims=True)
    return TitleOdds(
        title_probability=title_share.mean(axis=0),
        expected_points=totals.mean(axis=0),
        points_p10=np.percentile(totals, 10, axis=0),
        points_p90=np.percentile(totals, 90, axis=0),
    )


def simulate_title_odds(current_points: np.ndarray, races: list[RemainingRace], n: int, seed: int) -> TitleOdds:
    return summarize_totals(simulate_season_totals(current_points, races, n, seed))

FORM_WINDOW = 5
# A driver absent from recent predictions (e.g. a mid-season replacement) keeps a token chance —
# zero would make the Gumbel sampler place them last in every simulated race.
_MIN_WIN_PROB = 0.001


def form_win_probs(history: list[dict[int, float]], driver_ids: list[int], fallback: np.ndarray) -> np.ndarray:
    """Win probabilities for a race the model hasn't predicted yet (features only exist after
    qualifying): each driver's mean predicted win probability over the last FORM_WINDOW races."""
    recent = history[-FORM_WINDOW:]
    if not recent:
        return fallback / fallback.sum()
    probs = np.array([np.mean([race.get(d, 0.0) for race in recent]) for d in driver_ids])
    probs = np.maximum(probs, _MIN_WIN_PROB)
    return probs / probs.sum()


_SPRINT_FORMATS = {"sprint", "sprint_qualifying", "sprint_shootout"}
_SPRINT_PENDING = {"scheduled", "sprint_qualifying_done"}


def _vector(prediction: dict[int, float], driver_ids: list[int]) -> np.ndarray:
    probs = np.maximum(np.array([prediction.get(d, 0.0) for d in driver_ids]), _MIN_WIN_PROB)
    return probs / probs.sum()


def build_remaining_races(
    races: list[dict],
    gp_predictions: dict[int, dict[int, float]],
    sprint_predictions: dict[int, dict[int, float]],
    driver_ids: list[int],
) -> list[RemainingRace]:
    """Races in round order → the sessions still to run. A session with its own prediction
    (features exist once qualifying is in) uses it; later ones fall back to recent GP form."""
    ordered = sorted(races, key=lambda r: r["round_number"])
    history = [gp_predictions[r["id"]] for r in ordered if r["id"] in gp_predictions]
    form = form_win_probs(history, driver_ids, fallback=np.ones(len(driver_ids)))

    remaining: list[RemainingRace] = []
    for race in ordered:
        if race["status"] == "completed":
            continue
        if race["event_format"] in _SPRINT_FORMATS and race["status"] in _SPRINT_PENDING:
            sprint = sprint_predictions.get(race["id"])
            remaining.append(RemainingRace(_vector(sprint, driver_ids) if sprint else form, SPRINT_POINTS))
        gp = gp_predictions.get(race["id"])
        remaining.append(RemainingRace(_vector(gp, driver_ids) if gp else form, GP_POINTS))
    return remaining
