from src.utils.driver_map import build_driver_code_map, build_driver_number_map
from tests.support.fake_db import FakeConnection


class TestBuildDriverCodeMap:
    def test_maps_driver_code_to_id(self):
        conn = FakeConnection([
            [{"code": "VER", "id": 10}, {"code": "LEC", "id": 11}],
        ])

        result = build_driver_code_map(conn, season_id=2025)

        assert result == {"VER": 10, "LEC": 11}


class TestBuildDriverNumberMap:
    def test_maps_driver_number_to_id(self):
        conn = FakeConnection([
            [{"driver_number": 1, "id": 10}, {"driver_number": 16, "id": 11}],
        ])

        result = build_driver_number_map(conn, season_id=2025)

        assert result == {1: 10, 16: 11}
