from src.utils.driver_registry import SeasonDrivers, season_drivers
from tests.support.fake_db import FakeConnection


class TestSeasonDrivers:
    def test_finds_a_driver_by_car_number_or_by_code(self):
        conn = FakeConnection([[
            {"id": 10, "code": "VER", "driver_number": 1}, {"id": 11, "code": "LEC", "driver_number": 16},
        ]])

        drivers = season_drivers(conn, season_id=2025)

        assert drivers.id_for(16) == 11
        assert drivers.id_for(code="VER") == 10

    def test_a_number_the_season_does_not_know_falls_back_to_the_code(self):
        drivers = SeasonDrivers(by_number={1: 10}, by_code={"HAM": 44})

        assert drivers.id_for(99, "HAM") == 44
        assert drivers.id_for(99) is None
