import pytest

from datetime import date

from src.utils.model_v4 import brier_score, measured_overtake_rates, rescore_with_overtake_rate, shrink_toward_prior


class TestShrinkTowardPrior:
    def test_no_measured_races_keeps_the_seeded_prior(self):
        assert shrink_toward_prior(measured=0.9, prior=0.3, n=0, k=2) == 0.3

    def test_zero_shrinkage_with_no_measured_races_still_returns_the_prior(self):
        assert shrink_toward_prior(measured=0.9, prior=0.3, n=0, k=0) == 0.3

    def test_k_measured_races_land_halfway_between_prior_and_measurement(self):
        assert shrink_toward_prior(measured=0.9, prior=0.3, n=2, k=2) == pytest.approx(0.6)


class TestMeasuredOvertakeRates:
    def test_ranks_circuits_by_passes_per_car_lap_using_only_earlier_races(self):
        samples = [
            {"circuit_id": 1, "date": date(2024, 5, 26), "passes": 4, "car_laps": 1_560},    # Monaco-like
            {"circuit_id": 2, "date": date(2024, 9, 1), "passes": 60, "car_laps": 1_060},
            {"circuit_id": 3, "date": date(2024, 3, 2), "passes": 120, "car_laps": 1_140},   # Bahrain-like
            {"circuit_id": 3, "date": date(2025, 4, 13), "passes": 999, "car_laps": 1_140},  # after cutoff
        ]

        rates = measured_overtake_rates(samples, before=date(2025, 1, 1))

        assert rates == {1: (0.0, 1), 2: (0.5, 1), 3: (1.0, 1)}


class TestBrierScore:
    def test_multi_class_brier_for_a_two_driver_race(self):
        # Winner A predicted at 0.7: (0.7-1)^2 + (0.3-0)^2 = 0.18.
        assert brier_score({"A": 0.7, "B": 0.3}, winner="A") == pytest.approx(0.18)

    def test_a_perfect_call_scores_zero(self):
        assert brier_score({"A": 1.0, "B": 0.0}, winner="A") == 0


class TestRescoreWithOvertakeRate:
    def test_moves_only_the_circuit_adjusted_features_then_reapplies_the_softmax(self):
        # Stored at overtake 0.5 (start × 1.5, gain × 0.5); rescored at overtake 1.0 (start × 1, gain × 1).
        rows = [
            {"driver_id": "A", "raw_weighted_score": 0.6, "starting_position_score": 0.6, "position_gain_score": 0.5,
             "circuit_adj_start_pos_score": 0.9, "circuit_adj_position_gain_score": 0.25},
            {"driver_id": "B", "raw_weighted_score": 0.5, "starting_position_score": 0.2, "position_gain_score": 0.5,
             "circuit_adj_start_pos_score": 0.3, "circuit_adj_position_gain_score": 0.25},
        ]

        probs = rescore_with_overtake_rate(rows, overtake_rate=1.0, sc_probability=0.0)

        # Hand-worked: raw A 0.5865, raw B 0.5005 → softmax(T=0.3) gives A ≈ 0.5712.
        assert probs["A"] == pytest.approx(0.5712, abs=1e-3)
        assert probs["A"] + probs["B"] == pytest.approx(1.0)
