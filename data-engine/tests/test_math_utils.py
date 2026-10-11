import math

import pytest

from src.jobs.compute_features import WEIGHTS as GP_WEIGHTS
from src.jobs.compute_sprint_features import WEIGHTS as SPRINT_WEIGHTS
from src.utils.math_utils import bayesian_win_rate, clamp, normalize_minmax, softmax, weighted_sum


class TestNormalizeMinmax:
    def test_spreads_values_into_zero_one_range(self):
        result = normalize_minmax([10.0, 20.0, 30.0])
        assert result == pytest.approx([0.0, 0.5, 1.0])

    def test_all_equal_values_returns_default(self):
        result = normalize_minmax([5.0, 5.0, 5.0], default=0.5)
        assert result == [0.5, 0.5, 0.5]

    def test_single_value_returns_default(self):
        result = normalize_minmax([42.0], default=0.5)
        assert result == [0.5]

    def test_handles_negative_values(self):
        result = normalize_minmax([-10.0, 0.0, 10.0])
        assert result == pytest.approx([0.0, 0.5, 1.0])


class TestSoftmax:
    def test_probabilities_sum_to_one(self):
        probs = softmax([0.9, 0.6, 0.3, 0.1])
        assert sum(probs) == pytest.approx(1.0, abs=1e-9)

    def test_higher_score_gets_higher_probability(self):
        probs = softmax([0.9, 0.6, 0.3])
        assert probs[0] > probs[1] > probs[2]

    def test_equal_scores_split_evenly(self):
        probs = softmax([0.5, 0.5, 0.5])
        assert probs == pytest.approx([1 / 3, 1 / 3, 1 / 3])

    def test_lower_temperature_sharpens_distribution(self):
        scores = [0.9, 0.6, 0.3]
        sharp = softmax(scores, temperature=0.1)
        soft = softmax(scores, temperature=1.0)
        assert sharp[0] > soft[0]

    def test_numerically_stable_for_large_scores(self):
        probs = softmax([1000.0, 999.0, 998.0], temperature=0.3)
        assert all(math.isfinite(p) for p in probs)
        assert sum(probs) == pytest.approx(1.0, abs=1e-9)

    def test_default_temperature_matches_model_spec(self):
        # Model docs specify T=0.3 as the hardcoded temperature: this pins that default.
        scores = [0.9, 0.6]
        assert softmax(scores) == pytest.approx(softmax(scores, temperature=0.3))


class TestBayesianWinRate:
    def test_no_races_yields_prior(self):
        assert bayesian_win_rate(0, 0) == pytest.approx(0.25)

    def test_matches_formula(self):
        assert bayesian_win_rate(3, 10) == pytest.approx((3 + 0.5) / (10 + 2))

    def test_more_wins_increases_rate(self):
        assert bayesian_win_rate(5, 10) > bayesian_win_rate(1, 10)


class TestClamp:
    def test_within_bounds_unchanged(self):
        assert clamp(0.5) == 0.5

    def test_clamps_above_hi(self):
        assert clamp(1.5) == 1.0

    def test_clamps_below_lo(self):
        assert clamp(-0.5) == 0.0

    def test_custom_bounds(self):
        assert clamp(15.0, lo=0.0, hi=10.0) == 10.0


class TestWeightedSum:
    def test_matches_manual_dot_product(self):
        scores = {"a": 0.8, "b": 0.4, "c": 1.0}
        weights = {"a": 0.5, "b": 0.3, "c": 0.2}
        expected = 0.8 * 0.5 + 0.4 * 0.3 + 1.0 * 0.2
        assert weighted_sum(scores, weights) == pytest.approx(expected)

    def test_ignores_extra_score_keys_not_in_weights(self):
        scores = {"a": 1.0, "b": 1.0, "unused": 999.0}
        weights = {"a": 0.6, "b": 0.4}
        assert weighted_sum(scores, weights) == pytest.approx(1.0)

    def test_missing_weighted_feature_raises(self):
        scores = {"a": 1.0}
        weights = {"a": 0.5, "b": 0.5}
        with pytest.raises(KeyError):
            weighted_sum(scores, weights)

    def test_gp_weights_applied_to_all_max_scores_sums_to_one(self):
        # If every feature scores a perfect 1.0, the weighted sum must equal the
        # weight total (1.0): this is what a bug in weight application would break.
        scores = {feature: 1.0 for feature in GP_WEIGHTS}
        assert weighted_sum(scores, GP_WEIGHTS) == pytest.approx(1.0)

    def test_sprint_weights_applied_to_all_max_scores_sums_to_one(self):
        scores = {feature: 1.0 for feature in SPRINT_WEIGHTS}
        assert weighted_sum(scores, SPRINT_WEIGHTS) == pytest.approx(1.0)
