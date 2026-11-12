import json
from pathlib import Path

import pytest

from src.utils.gp_features_v4 import GP_V4_FEATURES
from src.utils.gp_model_v4 import importance_percentages, load_committed

# weighted-v4's fitted weights live in src/models/gp_v4.json and reach the site as importances in the
# shared JSON; sprint-v3 serves the same weights, so it has no entry of its own.

FEATURE_WEIGHTS_JSON = Path(__file__).resolve().parents[2] / "docs" / "feature-weights.json"


def _shared() -> dict:
    return json.loads(FEATURE_WEIGHTS_JSON.read_text())


def test_the_committed_gp_model_scores_exactly_the_computed_features():
    assert load_committed().model.features == GP_V4_FEATURES


def test_gp_features_in_the_shared_json_follow_the_model():
    assert tuple(_shared()["gp"]) == GP_V4_FEATURES


def test_gp_importances_in_the_shared_json_match_the_committed_fit():
    # Fails after a refit until fit_model_v4.py's JSON update is committed with it.
    shared = _shared()["gp"]
    assert {f: shared[f]["importance"] for f in GP_V4_FEATURES} == importance_percentages(load_committed().model)
