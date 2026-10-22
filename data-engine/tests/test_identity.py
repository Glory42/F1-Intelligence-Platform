import json
from pathlib import Path

import pytest

from src.utils.identity import constructor_key, is_same_person, person_ids, person_key

CASES = json.loads((Path(__file__).parents[2] / "docs" / "identity-cases.json").read_text())


@pytest.mark.parametrize("case", CASES["people"], ids=lambda c: c["personKey"])
def test_person_key_matches_the_golden_cases(case):
    assert person_key(case["firstName"], case["lastName"]) == case["personKey"]


@pytest.mark.parametrize("case", CASES["samePerson"], ids=lambda c: f"{c['a'][2]}~{c['b'][2]}")
def test_is_same_person_matches_the_golden_cases(case):
    assert is_same_person(tuple(case["a"]), tuple(case["b"])) is case["same"]


@pytest.mark.parametrize("keys", CASES["sameConstructor"], ids=lambda k: k[-1])
def test_one_outfit_shares_a_constructor_key(keys):
    assert len({constructor_key(k) for k in keys}) == 1


@pytest.mark.parametrize("pair", CASES["distinctConstructors"], ids=lambda p: "-".join(p))
def test_sister_teams_stay_apart(pair):
    assert constructor_key(pair[0]) != constructor_key(pair[1])


class TestPersonIds:
    def test_links_one_person_across_seasons_and_name_spellings(self):
        ids = person_ids([
            {"id": 1, "code": "ANT", "first_name": "Andrea", "last_name": "Kimi Antonelli"},
            {"id": 2, "code": "ANT", "first_name": "Kimi", "last_name": "Antonelli"},
            {"id": 3, "code": "PER", "first_name": "Sergio", "last_name": "Pérez"},
            {"id": 4, "code": "PER", "first_name": "Sergio", "last_name": "Perez"},
        ])

        assert ids[1] == ids[2]
        assert ids[3] == ids[4]
        assert ids[1] != ids[3]

    def test_a_shared_code_alone_does_not_merge_two_people(self):
        ids = person_ids([
            {"id": 1, "code": "VER", "first_name": "Jean-Eric", "last_name": "Vergne"},
            {"id": 2, "code": "VER", "first_name": "Max", "last_name": "Verstappen"},
            {"id": 3, "code": "MSC", "first_name": "Michael", "last_name": "Schumacher"},
            {"id": 4, "code": "MSC", "first_name": "Mick", "last_name": "Schumacher"},
        ])

        assert len(set(ids.values())) == 4
