"""Covers plan_season: one season's diff between our drivers/results and F1DB, code fixes, new
drivers (including stand-ins sharing a car number), and results rebuilt from F1DB."""
from src.utils.f1db_backfill import SeasonInput, plan_season


def _f1(id_, first, last, abbr):
    return {"id": id_, "name": f"{first} {last}", "firstName": first, "lastName": last, "fullName": f"{first} {last}", "abbreviation": abbr}


F1_DRIVERS = {
    "felipe-massa": _f1("felipe-massa", "Felipe", "Massa", "MAS"),
    "luca-badoer": _f1("luca-badoer", "Luca", "Badoer", "BAD"),
    "ayrton-senna": _f1("ayrton-senna", "Ayrton", "Senna", "SEN"),
}
CONSTRUCTORS = {"ferrari": {"id": "ferrari", "name": "Ferrari"}, "brawn": {"id": "brawn", "name": "Brawn"}}


def _race_rec(driver_id, position, round_=1, number="3", constructor="ferrari"):
    return {"year": 2009, "round": round_, "driverId": driver_id, "driverNumber": number, "constructorId": constructor,
            "positionNumber": position, "positionText": str(position) if position else "DNF", "gapLaps": None,
            "reasonRetired": None if position else "Engine", "gridPositionNumber": position or 10,
            "points": 10 if position == 1 else 0, "timeMillis": None, "fastestLap": False}


def _quali_rec(driver_id, position, round_=1):
    return {"year": 2009, "round": round_, "driverId": driver_id, "positionNumber": position, "positionDisplayOrder": position,
            "timeMillis": None, "q1Millis": 80_000 + position, "q2Millis": None, "q3Millis": None}


def _input(**overrides):
    base = dict(
        season_id=1,
        drivers=[{"id": 11, "code": "MAS", "driver_number": 3, "first_name": "Felipe", "last_name": "Massa", "team_id": 100}],
        teams=[{"id": 100, "team_key": "ferrari", "name": "Ferrari"}],
        races=[{"id": 500, "round_number": 1, "race_date": "2009-08-23"}],
        race_results=[{"race_id": 500, "driver_id": 11, "finish_position": 1, "grid_position": 1, "points": 10.0,
                       "status": "Finished", "total_race_time_ms": None, "fastest_lap": False}],
        qualifying_results=[],
        f1db_drivers=F1_DRIVERS,
        f1db_constructors=CONSTRUCTORS,
        f1db_races={1: "2009-08-23"},
        f1db_race_results=[_race_rec("felipe-massa", 1), _race_rec("luca-badoer", None)],
        f1db_qualifying=[_quali_rec("felipe-massa", 1), _quali_rec("luca-badoer", 2)],
    )
    base.update(overrides)
    return SeasonInput(**base)


def test_a_stand_in_sharing_the_car_number_becomes_a_new_driver_on_that_team():
    plan = plan_season(_input())

    assert [(d.code, d.driver_number, d.first_name, d.last_name, d.team_ref) for d in plan.new_drivers] == [
        ("BAD", 3, "Luca", "Badoer", 100)]
    assert plan.new_teams == []


def test_results_are_rebuilt_from_f1db_and_new_drivers_are_referenced_by_f1db_id():
    plan = plan_season(_input())

    rows = {r["driver_ref"]: r for r in plan.race_rows}
    assert rows[11]["finish_position"] == 1
    assert rows["luca-badoer"]["status"] == "Engine"
    assert plan.changed_race_rows == 1
    assert {r["driver_ref"] for r in plan.qualifying_rows} == {11, "luca-badoer"}


def test_nan_codes_are_replaced_by_the_f1db_abbreviation():
    plan = plan_season(_input(drivers=[{"id": 11, "code": "NAN", "driver_number": 3, "first_name": "Felipe",
                                        "last_name": "Massa", "team_id": 100}]))

    assert plan.code_fixes == {11: "MAS"}


def test_a_result_filed_under_the_wrong_driver_is_deleted():
    plan = plan_season(_input(
        drivers=[
            {"id": 11, "code": "MAS", "driver_number": 3, "first_name": "Felipe", "last_name": "Massa", "team_id": 100},
            {"id": 12, "code": "SEN", "driver_number": 12, "first_name": "Ayrton", "last_name": "Senna", "team_id": 100},
        ],
        race_results=[{"race_id": 500, "driver_id": 12, "finish_position": 1, "grid_position": 1, "points": 10.0,
                       "status": "Finished", "total_race_time_ms": None, "fastest_lap": False}],
        # Senna raced this season (round 2), just not in round 1: the code collapse credited him anyway.
        f1db_race_results=[_race_rec("felipe-massa", 1), _race_rec("luca-badoer", None), _race_rec("ayrton-senna", 3, round_=2)],
    ))

    assert plan.race_deletes == [(500, 12)]


def test_a_new_drivers_unknown_constructor_becomes_a_new_team():
    plan = plan_season(_input(f1db_race_results=[_race_rec("felipe-massa", 1), _race_rec("luca-badoer", None, constructor="brawn")]))

    assert [(t.team_key, t.name) for t in plan.new_teams] == [("brawn", "Brawn")]
    assert plan.new_drivers[0].team_ref == "brawn"


def test_rounds_whose_dates_disagree_are_reported_and_skipped():
    plan = plan_season(_input(f1db_races={1: "2009-09-13"}))

    assert plan.date_mismatches == [(1, "2009-08-23", "2009-09-13")]
    assert plan.race_rows == []


def test_our_drivers_f1db_cannot_place_are_reported():
    plan = plan_season(_input(drivers=[{"id": 11, "code": "XXX", "driver_number": 3, "first_name": "Nobody",
                                        "last_name": "Known", "team_id": 100}]))

    assert plan.unmatched_drivers == [11]
    assert plan.race_deletes == []


def test_a_driver_split_across_two_car_numbers_is_merged_into_one_row():
    # The old (season, number) key gave a mid-season number change its own row.
    plan = plan_season(_input(
        drivers=[
            {"id": 11, "code": "MAS", "driver_number": 3, "first_name": "Felipe", "last_name": "Massa", "team_id": 100},
            {"id": 19, "code": "MAS", "driver_number": 7, "first_name": "Felipe", "last_name": "Massa", "team_id": 100},
        ],
        race_results=[{"race_id": 500, "driver_id": 19, "finish_position": 1, "grid_position": 1, "points": 10.0,
                       "status": "Finished", "total_race_time_ms": None, "fastest_lap": False}],
    ))

    assert plan.merges == {19: 11}
    assert plan.unmatched_drivers == []
    assert (500, 19) in plan.race_deletes
    assert {r["driver_ref"] for r in plan.race_rows} == {11, "luca-badoer"}


def test_races_not_yet_marked_completed_are_rebuilt_and_completed():
    plan = plan_season(_input(races=[{"id": 500, "round_number": 1, "race_date": "2009-08-23", "status": "scheduled"}]))

    assert plan.complete_races == [500]
