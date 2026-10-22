from dataclasses import dataclass


@dataclass(frozen=True)
class FeatureSpec:
    name: str
    weight: float
    label: str
    nullable: bool


SPRINT_FEATURES: tuple[FeatureSpec, ...] = (
    FeatureSpec("car_performance", 0.25, "Car Performance", nullable=False),
    FeatureSpec("circuit_adj_start_pos", 0.25, "Circuit-Adj. Starting Position", nullable=True),
    FeatureSpec("short_run_pace", 0.10, "Short Run Pace", nullable=False),
    FeatureSpec("driver_rating", 0.10, "Driver Rating", nullable=False),
    FeatureSpec("weather_impact", 0.08, "Weather Impact", nullable=False),
    FeatureSpec("win_rate", 0.08, "Win Rate", nullable=False),
    FeatureSpec("luck_factor", 0.08, "Luck Factor", nullable=False),
    FeatureSpec("sq_qualifying_delta", 0.06, "SQ vs Teammate", nullable=True),
)
SPRINT_WEIGHTS: dict[str, float] = {f.name: f.weight for f in SPRINT_FEATURES}

# The hand-weighted sprint model's softmax temperature. weighted-v4 (GP) has no separate one: its fitted
# weights already carry the scale, so its scores go through a plain softmax (T = 1).
SPRINT_SOFTMAX_TEMPERATURE = 0.3


def assemble_scores(values: dict[str, float], features: tuple[FeatureSpec, ...]) -> dict[str, float]:
    """Raises KeyError if a manifest feature's score was never computed, instead of
    silently summing an incomplete weighted score."""
    return {f.name: values[f.name] for f in features}
