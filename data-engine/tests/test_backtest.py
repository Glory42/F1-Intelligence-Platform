import math

import pytest

from src.utils.backtest import (
    GridWinRates,
    calibration_table,
    paired_difference,
    race_metrics,
    summarize,
)


class TestRaceMetrics:
    def test_a_confident_correct_pick_scores_well_on_every_metric(self):
        m = race_metrics({1: 0.8, 2: 0.15, 3: 0.05}, winner=1)

        assert m["log_loss"] == pytest.approx(-math.log(0.8))
        assert m["brier"] == pytest.approx(0.2**2 + 0.15**2 + 0.05**2)
        assert m["top1"] == 1
        assert m["top3"] == 1

    def test_a_winner_ranked_fourth_misses_top1_and_top3(self):
        m = race_metrics({1: 0.4, 2: 0.3, 3: 0.2, 4: 0.1}, winner=4)

        assert m["top1"] == 0
        assert m["top3"] == 0
        assert m["log_loss"] == pytest.approx(-math.log(0.1))

    def test_a_winner_given_zero_probability_has_finite_log_loss(self):
        m = race_metrics({1: 1.0, 2: 0.0}, winner=2)

        assert math.isfinite(m["log_loss"])
        assert m["log_loss"] > 20

    def test_tied_probabilities_earn_the_expected_hit_of_a_random_tie_break(self):
        m = race_metrics({1: 0.25, 2: 0.25, 3: 0.25, 4: 0.25}, winner=1)

        assert m["top1"] == pytest.approx(0.25)
        assert m["top3"] == pytest.approx(0.75)


class TestSummarize:
    def test_averages_each_metric_over_races(self):
        races = [
            {"log_loss": 1.0, "brier": 0.5, "top1": 1, "top3": 1},
            {"log_loss": 3.0, "brier": 0.9, "top1": 0, "top3": 1},
        ]

        assert summarize(races) == {"races": 2, "log_loss": 2.0, "brier": 0.7, "top1": 0.5, "top3": 1.0}

    def test_no_races_gives_an_empty_summary(self):
        assert summarize([]) == {"races": 0}


class TestPairedDifference:
    def test_compares_only_races_both_models_scored(self):
        diff = paired_difference({1: 1.0, 2: 2.0, 3: 0.5}, {1: 1.5, 2: 2.5, 4: 9.0})

        assert diff == {"races": 2, "mean": pytest.approx(-0.5), "se": pytest.approx(0.0)}

    def test_standard_error_shrinks_with_consistent_gaps(self):
        noisy = paired_difference({1: 0.0, 2: 2.0, 3: 0.0, 4: 2.0}, {1: 1.0, 2: 1.0, 3: 1.0, 4: 1.0})
        steady = paired_difference({1: 0.9, 2: 1.1, 3: 0.9, 4: 1.1}, {1: 1.0, 2: 1.0, 3: 1.0, 4: 1.0})

        assert steady["se"] < noisy["se"]

    def test_too_few_shared_races_gives_nothing(self):
        assert paired_difference({1: 1.0}, {1: 2.0}) is None


class TestCalibrationTable:
    def test_buckets_predictions_and_reports_how_often_they_won(self):
        pairs = [(0.9, True), (0.8, False), (0.85, True), (0.02, False), (0.03, False)]

        table = calibration_table(pairs, edges=(0.0, 0.1, 1.0))

        assert table == [
            {"lo": 0.0, "hi": 0.1, "n": 2, "mean_p": pytest.approx(0.025), "win_rate": 0.0},
            {"lo": 0.1, "hi": 1.0, "n": 3, "mean_p": pytest.approx(0.85), "win_rate": pytest.approx(2 / 3)},
        ]

    def test_empty_buckets_are_left_out(self):
        assert calibration_table([(0.5, True)], edges=(0.0, 0.1, 1.0)) == [
            {"lo": 0.1, "hi": 1.0, "n": 1, "mean_p": 0.5, "win_rate": 1.0},
        ]


class TestGridWinRates:
    def test_with_no_history_every_grid_slot_is_equally_likely(self):
        rates = GridWinRates()

        probs = rates.probabilities({10: 1, 11: 2, 12: 3})

        assert probs == pytest.approx({10: 1 / 3, 11: 1 / 3, 12: 1 / 3})

    def test_learns_that_pole_wins_more_often_from_past_races_only(self):
        rates = GridWinRates()
        for _ in range(5):
            rates.record([(1, True), (2, False), (3, False)])

        probs = rates.probabilities({10: 1, 11: 2, 12: 3})

        assert probs[10] > probs[11]
        assert sum(probs.values()) == pytest.approx(1.0)

    def test_pit_lane_and_unknown_starts_share_the_back_of_grid_slot(self):
        rates = GridWinRates()
        rates.record([(0, True), (None, False), (30, False)])

        assert rates.slot(0) == rates.slot(None) == rates.slot(30) == GridWinRates.BACK_SLOT
