import json
from pathlib import Path

import pytest

from src.utils.f1db import (
    Milestones, career_milestones, constructor_row, constructor_seasons, driver_row, normalize_person_name,
)
from tests.support.f1db_fixtures import load_f1db_fixture

# Shared with apps/api's identity.test.ts, so both sides agree on the core-driver -> F1DB join key.
IDENTITY_CASES = json.loads((Path(__file__).parents[2] / "docs" / "identity-cases.json").read_text())


class TestNormalizePersonName:
    @pytest.mark.parametrize("case", IDENTITY_CASES["people"], ids=lambda c: f"{c['firstName']} {c['lastName']}".strip())
    def test_matches_the_shared_f1db_person_key(self, case):
        assert normalize_person_name(f"{case['firstName']} {case['lastName']}") == case["f1dbPersonKey"]


class TestCareerMilestones:
    def test_verstappens_first_start_win_podium_and_pole(self):
        milestones = career_milestones(
            load_f1db_fixture("race_results_verstappen_2015_2019"), load_f1db_fixture("races_verstappen_2015_2019"),
        )["max-verstappen"]

        assert milestones.first_race == ("2015-03-15", "2015 Formula 1 Rolex Australian Grand Prix")
        assert milestones.first_win == ("2016-05-15", "Formula 1 Gran Premio de España Pirelli 2016")
        assert milestones.first_podium == milestones.first_win
        assert milestones.first_pole == ("2019-08-04", "Formula 1 Rolex Magyar Nagydíj 2019")


class TestDriverRow:
    def test_maps_bio_and_career_totals_with_milestones(self):
        verstappen = next(d for d in load_f1db_fixture("drivers") if d["id"] == "max-verstappen")
        milestones = Milestones(first_race=("2015-03-15", "Australian GP"), first_win=("2016-05-15", "Spanish GP"))

        row = driver_row(verstappen, milestones)

        assert row["f1db_id"] == "max-verstappen"
        assert row["match_key"] == "max verstappen"
        assert row["date_of_birth"] == "1997-09-30"
        assert row["nationality"] == "netherlands"
        assert (row["championships"], row["race_starts"], row["race_wins"], row["podiums"], row["pole_positions"]) == (4, 249, 72, 135, 49)
        assert (row["first_race_date"], row["first_race_name"]) == ("2015-03-15", "Australian GP")
        assert (row["first_win_date"], row["first_pole_date"]) == ("2016-05-15", None)


class TestConstructorSeasons:
    def test_lists_each_seasons_chassis_and_engine_by_display_name(self):
        rows = constructor_seasons(
            load_f1db_fixture("entrants_chassis_red_bull"),
            load_f1db_fixture("entrants_engines_red_bull"),
            chassis_names={"red-bull-rb20": "RB20", "red-bull-rb21": "RB21", "red-bull-rb22": "RB22"},
            engine_names={"honda-rbpt": "Honda RBPT", "red-bull-ford": "Red Bull Ford"},
        )

        assert [(r["constructor_f1db_id"], r["year"], r["chassis"], r["engine"]) for r in rows] == [
            ("red-bull", 2024, "RB20", "Honda RBPT"),
            ("red-bull", 2025, "RB21", "Honda RBPT"),
            ("red-bull", 2026, "RB22", "Red Bull Ford"),
        ]


class TestConstructorRow:
    def test_maps_ferraris_career_totals(self):
        ferrari = next(c for c in load_f1db_fixture("constructors") if c["id"] == "ferrari")

        row = constructor_row(ferrari)

        assert (row["f1db_id"], row["name"], row["country"]) == ("ferrari", "Ferrari", "italy")
        assert (row["championships"], row["race_starts"], row["race_wins"], row["pole_positions"]) == (16, 1138, 250, 254)
