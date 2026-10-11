"""Covers f1db_results: matching our season-scoped driver rows to F1DB drivers, and turning F1DB
race / qualifying records into race_results / qualifying_results rows."""
from src.utils.f1db_results import match_f1db_driver, qualifying_row, race_row, race_status


def _f1db(id_, name, first, last, full=None):
    return {"id": id_, "name": name, "firstName": first, "lastName": last, "fullName": full or name}


SEASON = [
    _f1db("ayrton-senna", "Ayrton Senna", "Ayrton", "Senna", "Ayrton Senna da Silva"),
    _f1db("jj-lehto", "JJ Lehto", "JJ", "Lehto", "Jyrki Juhani Järvilehto"),
    _f1db("nelson-piquet", "Nelson Piquet", "Nelson", "Piquet"),
    _f1db("gerhard-berger", "Gerhard Berger", "Gerhard", "Berger"),
    _f1db("eric-bernard", "Éric Bernard", "Éric", "Bernard"),
]


class TestMatchF1dbDriver:
    def test_matches_on_name_ignoring_accents(self):
        assert match_f1db_driver("Eric", "Bernard", SEASON)["id"] == "eric-bernard"

    def test_falls_back_to_a_unique_surname(self):
        assert match_f1db_driver("A.", "Senna", SEASON)["id"] == "ayrton-senna"

    def test_knows_drivers_f1db_lists_under_another_name(self):
        assert match_f1db_driver("Jyrki", "Järvilehto", SEASON)["id"] == "jj-lehto"

    def test_no_match_outside_the_season(self):
        assert match_f1db_driver("Alain", "Prost", SEASON) is None


def _race(**overrides):
    rec = {"positionNumber": 1, "positionText": "1", "gapLaps": None, "reasonRetired": None,
           "gridPositionNumber": 2, "points": 9, "timeMillis": 5_400_123, "fastestLap": True}
    rec.update(overrides)
    return rec


class TestRaceStatus:
    def test_classified_finishers_are_finished_or_laps_down(self):
        assert race_status(_race()) == "Finished"
        assert race_status(_race(positionNumber=7, gapLaps=1)) == "+1 Lap"
        assert race_status(_race(positionNumber=9, gapLaps=3)) == "+3 Laps"

    def test_non_finishers_carry_the_reason(self):
        assert race_status(_race(positionNumber=None, positionText="DNF", reasonRetired="Gearbox")) == "Gearbox"
        assert race_status(_race(positionNumber=None, positionText="DNF")) == "Retired"
        assert race_status(_race(positionNumber=None, positionText="DSQ", reasonRetired="Underweight")) == "Disqualified"
        assert race_status(_race(positionNumber=None, positionText="DNS")) == "Did not start"


class TestRows:
    def test_race_row(self):
        assert race_row(_race(), race_id=5, driver_id=9) == {
            "race_id": 5, "driver_id": 9, "finish_position": 1, "grid_position": 2, "points": 9.0,
            "status": "Finished", "total_race_time_ms": 5_400_123, "fastest_lap": True,
        }

    def test_pit_lane_start_and_no_points(self):
        row = race_row(_race(gridPositionNumber=None, points=None, positionNumber=None, positionText="DNF"), race_id=5, driver_id=9)
        assert (row["grid_position"], row["points"], row["finish_position"]) == (0, 0.0, None)

    def test_qualifying_row_uses_the_single_session_time_before_knockout_qualifying(self):
        rec = {"positionNumber": 3, "positionDisplayOrder": 3, "timeMillis": 81_000, "q1Millis": None, "q2Millis": None, "q3Millis": None}
        assert qualifying_row(rec, race_id=5, driver_id=9) == {
            "race_id": 5, "driver_id": 9, "grid_position": 3, "q1_time_ms": 81_000, "q2_time_ms": None, "q3_time_ms": None,
        }

    def test_qualifying_row_keeps_knockout_times(self):
        rec = {"positionNumber": None, "positionDisplayOrder": 18, "timeMillis": None, "q1Millis": 90_100, "q2Millis": 89_500, "q3Millis": None}
        row = qualifying_row(rec, race_id=5, driver_id=9)
        assert (row["grid_position"], row["q1_time_ms"], row["q2_time_ms"]) == (18, 90_100, 89_500)
