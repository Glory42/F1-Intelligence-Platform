import pytest

from src.utils.feature_helpers import (
    car_rank, circuit_adj_start_pos, blend_car_perf,
    CAR_CIRCUIT_BLEND_MAX, CAR_CIRCUIT_MIN_RACES,
)
from src.utils.season_aggregates import compute_compressed_car_perf


class TestCarRank:
    def test_no_team_id_returns_midfield(self):
        assert car_rank(None, {}) == 10.0

    def test_unknown_team_defaults_to_neutral_perf(self):
        # team_perf.get(team_id, 0.5) falls back to 0.5 for an unknown team
        assert car_rank(99, {}) == pytest.approx(20.0 - 0.5 * 19.0)

    def test_top_car_ranks_near_one(self):
        assert car_rank(1, {1: 1.0}) == pytest.approx(1.0)

    def test_worst_car_ranks_near_twenty(self):
        assert car_rank(1, {1: 0.0}) == pytest.approx(20.0)


class TestCircuitAdjStartPos:
    def test_high_overtake_low_sc_reduces_penalty(self):
        # overtake_rate=1.0 -> (1 + (1 - 1)) = 1x multiplier, no amplification
        result = circuit_adj_start_pos(0.5, overtake_rate=1.0, sc_probability=0.0)
        assert result == pytest.approx(0.5)

    def test_low_overtake_amplifies_start_pos_score(self):
        # overtake_rate=0.0 -> 2x multiplier before clamping
        result = circuit_adj_start_pos(0.4, overtake_rate=0.0, sc_probability=0.0)
        assert result == pytest.approx(0.8)

    def test_high_sc_probability_dampens_score(self):
        base = circuit_adj_start_pos(0.5, overtake_rate=1.0, sc_probability=0.0)
        with_sc = circuit_adj_start_pos(0.5, overtake_rate=1.0, sc_probability=1.0)
        assert with_sc < base
        assert with_sc == pytest.approx(0.5 * 0.7)

    def test_result_is_clamped_to_unit_range(self):
        result = circuit_adj_start_pos(1.0, overtake_rate=0.0, sc_probability=0.0)
        assert result <= 1.0


class TestBlendCarPerf:
    def test_no_category_history_uses_season_unchanged(self):
        assert blend_car_perf(0.7, None, 0) == pytest.approx(0.7)

    def test_below_min_races_uses_season_unchanged(self):
        # car second driver may have < min races; blend must not move season signal
        assert blend_car_perf(0.7, 0.9, 1) == pytest.approx(0.7)

    def test_at_min_races_weight_is_zero(self):
        # exactly CAR_CIRCUIT_MIN_RACES races -> ramp is 0 -> season unchanged
        raw = blend_car_perf(0.7, 0.9, CAR_CIRCUIT_MIN_RACES)
        assert raw == pytest.approx(0.7)

    def test_high_history_ramps_toward_category(self):
        # many races -> weight at max; result strictly between season and category
        result = blend_car_perf(0.7, 1.0, 50)
        assert result > 0.7
        assert result < 1.0
        assert result == pytest.approx(0.7 * (1 - CAR_CIRCUIT_BLEND_MAX) + 1.0 * CAR_CIRCUIT_BLEND_MAX)

    def test_category_below_season_pulls_score_down(self):
        # e.g. Mercedes (season 1.0) at a category where it has a weak history
        result = blend_car_perf(1.0, 0.4, 20)
        assert result < 1.0
        assert result == pytest.approx(1.0 * (1 - CAR_CIRCUIT_BLEND_MAX) + 0.4 * CAR_CIRCUIT_BLEND_MAX)

    def test_ramp_monotonic_no_instability(self):
        # category (0.6) below season (0.8): weight ramps in, so score moves
        # monotonically DOWN toward category, then plateaus at max weight.
        prev = blend_car_perf(0.8, 0.6, CAR_CIRCUIT_MIN_RACES)
        for n in range(CAR_CIRCUIT_MIN_RACES + 1, 30):
            cur = blend_car_perf(0.8, 0.6, n)
            assert cur <= prev + 1e-9
            prev = cur
        # plateaus at the max-blend plateau for large n
        assert prev == pytest.approx(0.8 * (1 - CAR_CIRCUIT_BLEND_MAX) + 0.6 * CAR_CIRCUIT_BLEND_MAX)


class TestComputeCompressedCarPerf:
    def test_empty_signals_returns_empty(self):
        assert compute_compressed_car_perf([], []) == []

    def test_compresses_top_teams_avoiding_runaway_gap(self):
        # 4 teams spanning dominant winner -> close contender -> midfield -> backmarker.
        paces = [17.0, 15.5, 10.0, 5.0]
        grids = [18.0, 16.5, 11.0, 5.0]

        scores = compute_compressed_car_perf(paces, grids)

        # Team 1 is highest, but not blown up to 1.0; Team 2 remains tightly in contention
        assert len(scores) == 4
        assert scores[0] > scores[1] > scores[2] > scores[3]
        # Team 1 score should be under 0.96 (not forced to 1.0)
        assert scores[0] < 0.96
        # The gap between top team and 2nd team is compact (e.g. < 0.15 instead of 0.25+)
        assert (scores[0] - scores[1]) < 0.15

    def test_all_equal_signals_returns_equal_scores(self):
        scores = compute_compressed_car_perf([10.0, 10.0], [10.0, 10.0])
        assert scores[0] == pytest.approx(scores[1])

