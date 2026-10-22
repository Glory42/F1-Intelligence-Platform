import json
from pathlib import Path

import pytest

from src.jobs.compute_sprint_features import WEIGHTS as SPRINT_WEIGHTS
from src.utils.feature_manifest import SPRINT_FEATURES, SPRINT_SOFTMAX_TEMPERATURE, assemble_scores
from src.utils.gp_features_v4 import GP_V4_FEATURES
from src.utils.gp_model_v4 import importance_percentages, load_model

# The sprint model's hand weights must sum to 1 (the softmax pipeline assumes it); weighted-v4's
# fitted weights live in src/models/gp_v4.json and reach the site as importances in the shared JSON.

FEATURE_WEIGHTS_JSON = Path(__file__).resolve().parents[2] / "docs" / "feature-weights.json"


def _shared() -> dict:
    return json.loads(FEATURE_WEIGHTS_JSON.read_text())


def test_sprint_weights_sum_to_one():
    assert sum(SPRINT_WEIGHTS.values()) == pytest.approx(1.0, abs=1e-9)


def test_all_sprint_weights_positive():
    assert all(w > 0 for w in SPRINT_WEIGHTS.values())


def test_sprint_weights_has_eight_features():
    assert len(SPRINT_WEIGHTS) == 8


def test_assemble_scores_matches_sprint_manifest_keys():
    values = {f.name: 0.5 for f in SPRINT_FEATURES}
    assert set(assemble_scores(values, SPRINT_FEATURES).keys()) == set(SPRINT_WEIGHTS.keys())


def test_assemble_scores_raises_when_a_sprint_feature_is_missing():
    values = {f.name: 0.5 for f in SPRINT_FEATURES if f.name != "car_performance"}
    with pytest.raises(KeyError):
        assemble_scores(values, SPRINT_FEATURES)


def test_sprint_weights_and_labels_match_shared_json_fixture():
    expected = {f.name: {"weight": round(f.weight * 100), "label": f.label} for f in SPRINT_FEATURES}
    assert expected == _shared()["sprint"]


def test_sprint_softmax_temperature_matches_shared_json_fixture():
    assert SPRINT_SOFTMAX_TEMPERATURE == _shared()["sprint_softmax_temperature"]


def test_the_committed_gp_model_scores_exactly_the_computed_features():
    assert load_model().features == GP_V4_FEATURES


def test_gp_features_in_the_shared_json_follow_the_model():
    assert tuple(_shared()["gp"]) == GP_V4_FEATURES


def test_gp_importances_in_the_shared_json_match_the_committed_fit():
    # Fails after a refit until fit_model_v4.py's JSON update is committed with it.
    shared = _shared()["gp"]
    assert {f: shared[f]["importance"] for f in GP_V4_FEATURES} == importance_percentages(load_model())
