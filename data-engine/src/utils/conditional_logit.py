"""Conditional logit: P(driver wins) = softmax over the field of coef · standardized features.
The same shape as v3's weighted sum + softmax, but the weights (and so the temperature) are fitted
to past winners by maximum likelihood instead of chosen by hand."""
from dataclasses import dataclass
from typing import Hashable, Sequence

import numpy as np

# (feature matrix of one race's field, row index of its winner)
Race = tuple[np.ndarray, int]


@dataclass(frozen=True)
class LogitModel:
    features: tuple[str, ...]
    mean: np.ndarray
    scale: np.ndarray
    coef: np.ndarray

    def _standardize(self, x: np.ndarray) -> np.ndarray:
        return (x - self.mean) / self.scale

    def probabilities(self, field: dict[Hashable, dict[str, float]]) -> dict[Hashable, float]:
        drivers = list(field)
        x = np.array([[field[d][f] for f in self.features] for d in drivers], dtype=float)
        u = self._standardize(x) @ self.coef
        p = np.exp(u - u.max())
        p /= p.sum()
        return {d: float(pi) for d, pi in zip(drivers, p)}

    def contributions(self, values: dict[str, float]) -> dict[str, float]:
        """Each feature's term in the driver's score: what the prediction page can show per feature."""
        z = self._standardize(np.array([values[f] for f in self.features], dtype=float))
        return {f: float(c) for f, c in zip(self.features, z * self.coef)}


def _pad(standardized: Sequence[Race]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Fields differ in size, so stack them as (races, max field, features) with a mask of real cars."""
    width = max(len(z) for z, _ in standardized)
    k = standardized[0][0].shape[1]
    z = np.zeros((len(standardized), width, k))
    mask = np.zeros((len(standardized), width), dtype=bool)
    for i, (zi, _) in enumerate(standardized):
        z[i, : len(zi)] = zi
        mask[i, : len(zi)] = True
    winners = np.array([w for _, w in standardized])
    return z, mask, winners


def _field_probabilities(z: np.ndarray, mask: np.ndarray, coef: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    u = np.where(mask, z @ coef, -np.inf)
    top = u.max(axis=1, keepdims=True)
    e = np.exp(u - top)
    total = e.sum(axis=1, keepdims=True)
    log_p = u - top - np.log(total)
    return e / total, log_p


def _objective(padded: tuple[np.ndarray, np.ndarray, np.ndarray], coef: np.ndarray, l2: float) -> float:
    z, mask, winners = padded
    _, log_p = _field_probabilities(z, mask, coef)
    return float(log_p[np.arange(len(winners)), winners].sum() - 0.5 * l2 * coef @ coef)


def penalized_log_likelihood(races: Sequence[Race], model: LogitModel, l2: float) -> float:
    """What the fit maximizes: log P(each actual winner) minus the L2 penalty on standardized weights."""
    return _objective(_pad([(model._standardize(x), w) for x, w in races]), model.coef, l2)


def fit_conditional_logit(
    races: Sequence[Race], features: tuple[str, ...], l2: float = 1.0, max_iter: int = 100
) -> LogitModel:
    """Damped Newton on the L2-penalised log-likelihood. Features are standardized first, so one
    l2 shrinks every weight alike whatever its units; a constant feature gets weight 0."""
    stacked = np.vstack([x for x, _ in races])
    mean = stacked.mean(axis=0)
    std = stacked.std(axis=0)
    scale = np.where(std > 1e-12, std, 1.0)
    padded = _pad([((x - mean) / scale, w) for x, w in races])
    z, mask, winners = padded

    k = len(features)
    coef = np.zeros(k)
    current = _objective(padded, coef, l2)
    for _ in range(max_iter):
        p, _ = _field_probabilities(z, mask, coef)
        z_bar = np.einsum("rn,rnk->rk", p, z)
        grad = (z[np.arange(len(winners)), winners] - z_bar).sum(axis=0) - l2 * coef
        second = np.einsum("rn,rnj,rnk->jk", p, z, z) - z_bar.T @ z_bar
        # A constant feature has a zero row/column: keep the Hessian invertible without moving it.
        hess = -second - (l2 + 1e-9) * np.eye(k)
        step = np.linalg.solve(hess, grad)
        # Full Newton steps overshoot on long-tailed form features: halve until the likelihood improves.
        t = 1.0
        while t > 1e-6:
            candidate = coef - t * step
            value = _objective(padded, candidate, l2)
            if value >= current:
                break
            t /= 2
        else:
            break
        coef, current = candidate, value
        if np.abs(t * step).max() < 1e-8:
            break
    return LogitModel(features=features, mean=mean, scale=scale, coef=coef)
