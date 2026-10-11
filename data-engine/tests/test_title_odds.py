import numpy as np
import pytest

from src.utils.title_odds import (
    GP_POINTS, SPRINT_POINTS, RemainingRace, build_remaining_races, form_win_probs,
    sample_finishing_orders, simulate_title_odds,
)


class TestSampleFinishingOrders:
    def test_a_certain_winner_always_finishes_first(self):
        orders = sample_finishing_orders(np.array([1.0, 0.0, 0.0]), n=500, rng=np.random.default_rng(7))

        assert (orders[:, 0] == 0).all()

    def test_win_frequency_matches_the_win_probability(self):
        orders = sample_finishing_orders(np.array([0.5, 0.5]), n=10_000, rng=np.random.default_rng(7))

        assert (orders[:, 0] == 0).mean() == pytest.approx(0.5, abs=0.02)


class TestSimulateTitleOdds:
    def test_an_uncatchable_leader_is_champion_and_the_rest_are_eliminated(self):
        # 100 points ahead with one GP (25 max) left: no finishing order changes the champion.
        odds = simulate_title_odds(
            current_points=np.array([150.0, 50.0]),
            races=[RemainingRace(win_probs=np.array([0.1, 0.9]), points=GP_POINTS)],
            n=2_000,
            seed=1,
        )

        assert odds.title_probability.tolist() == [1.0, 0.0]

    def test_level_and_equally_quick_contenders_split_the_title(self):
        odds = simulate_title_odds(
            current_points=np.array([200.0, 200.0]),
            races=[RemainingRace(win_probs=np.array([0.5, 0.5]), points=GP_POINTS)] * 3,
            n=10_000,
            seed=3,
        )

        assert odds.title_probability.tolist() == pytest.approx([0.5, 0.5], abs=0.02)

    def test_a_driver_certain_to_win_every_race_banks_every_point(self):
        odds = simulate_title_odds(
            current_points=np.array([10.0, 0.0, 0.0]),
            races=[RemainingRace(win_probs=np.array([1.0, 0.0, 0.0]), points=GP_POINTS)] * 2,
            n=1_000,
            seed=5,
        )

        assert odds.expected_points[0] == 60.0
        assert odds.points_p10[0] == odds.points_p90[0] == 60.0

    def test_the_same_seed_reproduces_identical_odds(self):
        def run():
            return simulate_title_odds(
                current_points=np.array([120.0, 110.0, 90.0]),
                races=[RemainingRace(win_probs=np.array([0.4, 0.35, 0.25]), points=GP_POINTS)] * 4,
                n=5_000,
                seed=2026_18,
            )

        first, second = run(), run()

        assert np.array_equal(first.title_probability, second.title_probability)
        assert np.array_equal(first.points_p90, second.points_p90)


class TestFormWinProbs:
    def test_future_races_use_the_mean_of_the_last_five_predictions(self):
        history = [{1: 0.9, 2: 0.1}] * 3 + [{1: 0.5, 2: 0.5}] * 5  # oldest first

        probs = form_win_probs(history, driver_ids=[1, 2], fallback=np.array([0.5, 0.5]))

        assert probs.tolist() == pytest.approx([0.5, 0.5])

    def test_a_driver_missing_from_recent_predictions_keeps_a_small_chance(self):
        history = [{1: 0.7, 2: 0.3}] * 5

        probs = form_win_probs(history, driver_ids=[1, 2, 3], fallback=np.array([1.0, 1.0, 1.0]))

        assert 0 < probs[2] < 0.01
        assert probs.sum() == pytest.approx(1.0)


class TestBuildRemainingRaces:
    def test_only_unfinished_sessions_count_and_predicted_ones_use_their_prediction(self):
        races = [
            {"id": 1, "round_number": 1, "status": "completed", "event_format": "conventional"},
            {"id": 2, "round_number": 2, "status": "qualifying_done", "event_format": "conventional"},
            {"id": 3, "round_number": 3, "status": "scheduled", "event_format": "sprint_qualifying"},
        ]
        gp_predictions = {1: {7: 0.6, 8: 0.4}, 2: {7: 0.2, 8: 0.8}}

        remaining = build_remaining_races(races, gp_predictions, sprint_predictions={}, driver_ids=[7, 8])

        assert [r.points for r in remaining] == [GP_POINTS, SPRINT_POINTS, GP_POINTS]
        assert remaining[0].win_probs.tolist() == pytest.approx([0.2, 0.8])
        assert remaining[1].win_probs.tolist() == pytest.approx([0.4, 0.6])  # form: mean of rounds 1-2
