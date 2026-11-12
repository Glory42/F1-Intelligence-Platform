import math

import pytest

from src.utils.math_utils import bayesian_win_rate, clamp, normalize_minmax


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
