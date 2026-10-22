import numpy as np
import pytest

from src.utils.conditional_logit import LogitModel, fit_conditional_logit, penalized_log_likelihood


def _simulated_races(coef, n_races=400, field=10, seed=1):
    """Races whose winner is drawn from softmax(features · coef): a correct fit recovers coef."""
    rng = np.random.default_rng(seed)
    races = []
    for _ in range(n_races):
        x = rng.normal(size=(field, len(coef)))
        u = x @ np.array(coef)
        p = np.exp(u - u.max())
        p /= p.sum()
        races.append((x, int(rng.choice(field, p=p))))
    return races


class TestFit:
    def test_recovers_the_weights_that_generated_the_winners(self):
        model = fit_conditional_logit(_simulated_races([1.5, -0.5, 0.0]), ("a", "b", "c"), l2=0.0)

        # Features are standardized before fitting, so compare the slope per raw unit.
        assert model.coef / model.scale == pytest.approx([1.5, -0.5, 0.0], abs=0.25)

    def test_l2_shrinks_the_weights_toward_zero(self):
        races = _simulated_races([1.5, -0.5, 0.0])

        loose = fit_conditional_logit(races, ("a", "b", "c"), l2=0.0)
        tight = fit_conditional_logit(races, ("a", "b", "c"), l2=500.0)

        assert np.abs(tight.coef).sum() < np.abs(loose.coef).sum()

    def test_a_constant_feature_gets_no_weight_instead_of_breaking_the_fit(self):
        races = [(np.column_stack([x[:, 0], np.ones(len(x))]), w) for x, w in _simulated_races([1.0])]

        model = fit_conditional_logit(races, ("a", "flat"), l2=1.0)

        assert np.isfinite(model.coef).all()
        assert model.coef[1] == pytest.approx(0.0, abs=1e-9)

    @pytest.mark.parametrize("seed", range(3))
    def test_heavy_tailed_features_still_land_on_the_maximum(self, seed):
        # Form features are mostly ~0 with a long tail (a few dominant winners): undamped Newton
        # overshoots there into ever larger weights instead of converging.
        rng = np.random.default_rng(seed)
        races = []
        for _ in range(150):
            x = np.column_stack([rng.exponential(size=20) ** 3, rng.normal(size=20)])
            u = 1.5 * x[:, 0]
            p = np.exp(u - u.max())
            races.append((x, int(rng.choice(20, p=p / p.sum()))))

        model = fit_conditional_logit(races, ("a", "b"), l2=1.0)

        best = penalized_log_likelihood(races, model, l2=1.0)
        for i in range(2):
            for eps in (-1e-3, 1e-3):
                nudged = model.coef.copy()
                nudged[i] += eps
                other = LogitModel(model.features, model.mean, model.scale, nudged)
                assert penalized_log_likelihood(races, other, l2=1.0) <= best + 1e-9


class TestProbabilities:
    def test_scores_a_field_by_named_features_and_sums_to_one(self):
        model = LogitModel(
            features=("pace", "grid"), mean=np.array([0.0, 0.0]), scale=np.array([1.0, 1.0]),
            coef=np.array([2.0, 0.0]),
        )

        probs = model.probabilities({7: {"pace": 1.0, "grid": 5.0}, 8: {"pace": 0.0, "grid": -5.0}})

        assert sum(probs.values()) == pytest.approx(1.0)
        assert probs[7] == pytest.approx(np.exp(2) / (np.exp(2) + 1))

    def test_contributions_are_each_features_share_of_the_score(self):
        model = LogitModel(
            features=("pace", "grid"), mean=np.array([1.0, 0.0]), scale=np.array([2.0, 1.0]),
            coef=np.array([0.5, -1.0]),
        )

        assert model.contributions({"pace": 5.0, "grid": 3.0}) == pytest.approx({"pace": 1.0, "grid": -3.0})
