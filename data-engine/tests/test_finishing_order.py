import numpy as np
import pytest

from src.utils.finishing_order import finishing_order_forecast, place_probabilities, podium_probabilities, podium_updates

N = 200_000


def test_the_winner_follows_the_win_probabilities():
    places = place_probabilities(np.array([0.5, 0.3, 0.2]), N, np.random.default_rng(1))

    assert places[:, 0] == pytest.approx([0.5, 0.3, 0.2], abs=0.005)


def test_later_places_follow_plackett_luce_when_undiscounted():
    # P(A second) = P(B wins)·P(A | B gone) + P(C wins)·P(A | C gone) = 0.3·0.5/0.7 + 0.2·0.5/0.8
    places = place_probabilities(np.array([0.5, 0.3, 0.2]), N, np.random.default_rng(2))

    assert places[0, 1] == pytest.approx(0.3 * 0.5 / 0.7 + 0.2 * 0.5 / 0.8, abs=0.005)


def test_every_driver_finishes_somewhere_and_every_place_is_filled():
    places = place_probabilities(np.array([0.4, 0.3, 0.2, 0.1]), 10_000, np.random.default_rng(3))

    assert places.sum(axis=1) == pytest.approx(np.ones(4))
    assert places.sum(axis=0) == pytest.approx(np.ones(4))


def test_a_discount_below_one_flattens_the_places_after_the_win_only():
    win_probs = np.array([0.7, 0.2, 0.05, 0.05])
    raw = place_probabilities(win_probs, N, np.random.default_rng(4))
    discounted = place_probabilities(win_probs, N, np.random.default_rng(4), discount=0.5)

    assert discounted[:, 0] == pytest.approx(raw[:, 0], abs=0.005)
    assert discounted[3, :3].sum() > raw[3, :3].sum()


def test_the_discount_must_be_positive():
    with pytest.raises(ValueError):
        place_probabilities(np.array([0.5, 0.5]), 10, np.random.default_rng(0), discount=0)


def test_the_forecast_is_identical_for_the_same_seed():
    first = finishing_order_forecast(np.array([0.5, 0.3, 0.2]), (25, 18, 15), seed=42, n=5_000)
    again = finishing_order_forecast(np.array([0.5, 0.3, 0.2]), (25, 18, 15), seed=42, n=5_000)

    assert np.array_equal(first.expected_points, again.expected_points)


def test_podium_points_and_expected_points_come_from_the_places():
    win_probs = np.array([0.5, 0.2, 0.1, 0.1, 0.1])
    forecast = finishing_order_forecast(win_probs, (10, 5, 1), seed=7, n=N, podium_places=2)
    places = place_probabilities(win_probs, N, np.random.default_rng(7))

    assert forecast.podium == pytest.approx(places[:, :2].sum(axis=1), abs=1e-9)
    assert forecast.points_finish == pytest.approx(places[:, :3].sum(axis=1), abs=1e-9)
    assert forecast.expected_points == pytest.approx(places[:, :3] @ np.array([10, 5, 1]), abs=1e-9)
    assert forecast.expected_points.sum() == pytest.approx(16)


def test_the_backfill_writes_what_the_live_job_would_for_the_same_stored_field():
    stored = [
        {"race_id": 9, "driver_id": 4, "win_probability": 0.2, "predicted_position": 2},
        {"race_id": 9, "driver_id": 7, "win_probability": 0.7, "predicted_position": 1},
        {"race_id": 9, "driver_id": 2, "win_probability": 0.1, "predicted_position": 3},
        {"race_id": 9, "driver_id": 5, "win_probability": 0.0, "predicted_position": 4},
        {"race_id": 3, "driver_id": 1, "win_probability": 1.0, "predicted_position": 1},
    ]

    updates = {(race, driver): p for p, race, driver in podium_updates(stored)}

    live = podium_probabilities(np.array([0.7, 0.2, 0.1, 0.0]), seed=9)
    assert [updates[(9, d)] for d in (7, 4, 2, 5)] == pytest.approx([round(float(p), 5) for p in live])
    assert updates[(3, 1)] == pytest.approx(1.0)
