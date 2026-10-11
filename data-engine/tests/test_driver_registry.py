"""Covers driver_registry: turning a FastF1 session's driver list into entries (code fallbacks,
team keys, number coercion) and registering the drivers/teams a season is missing."""
from unittest.mock import MagicMock

from src.utils.driver_registry import SessionEntry, register_session_drivers, session_entries
from tests.support.fake_db import FakeConnection


def _info(*, team="Red Bull Racing", full="Max Verstappen", num="1", abbr="VER", country="NED"):
    return {"TeamName": team, "FullName": full, "DriverNumber": num, "Abbreviation": abbr, "CountryCode": country}


def _session(*infos):
    s = MagicMock()
    s.drivers = [i["DriverNumber"] for i in infos]
    by_number = {i["DriverNumber"]: i for i in infos}
    s.get_driver.side_effect = lambda n: by_number[n]
    return s


def _entry(code="VER", number=1, first="Max", last="Verstappen", team="red_bull_racing"):
    return SessionEntry(driver_number=number, code=code, first_name=first, last_name=last,
                        team_key=team, team_name="Team", nationality=None)


class TestSessionEntries:
    def test_reads_code_name_number_and_team_key(self):
        [entry] = session_entries(_session(_info(team="Racing-Bulls F1.Team", full="Isack Hadjar", num="6", abbr="HAD")))
        assert (entry.code, entry.first_name, entry.last_name, entry.driver_number, entry.team_key) == (
            "HAD", "Isack", "Hadjar", 6, "racing_bulls_f1team")

    def test_missing_abbreviation_falls_back_to_the_surname(self):
        [blank] = session_entries(_session(_info(full="Ayrton Senna", abbr="")))
        [nan] = session_entries(_session(_info(full="Ayrton Senna", abbr=float("nan"))))
        assert blank.code == "SEN"
        assert nan.code == "SEN"

    def test_short_fallback_code_is_padded_with_the_number(self):
        [entry] = session_entries(_session(_info(full="Guanyu Li", num="44", abbr="")))
        assert entry.code == "LI4"

    def test_non_numeric_driver_number_becomes_zero(self):
        [entry] = session_entries(_session(_info(num="X")))
        assert entry.driver_number == 0


class TestRegisterSessionDrivers:
    def test_inserts_a_driver_and_team_the_season_is_missing(self):
        conn = FakeConnection([
            [{"id": 100, "team_key": "red_bull_racing"}],                      # season teams
            {"id": 101},                                                       # INSERT team RETURNING
            [{"id": 1, "code": "VER", "first_name": "Max", "last_name": "Verstappen"}],  # season drivers
            {"id": 7},                                                         # INSERT driver RETURNING
        ])

        driver_map = register_session_drivers(conn, 10, [
            _entry(),
            _entry(code="COL", number=43, first="Franco", last="Colapinto", team="alpine"),
        ])

        assert driver_map == {"VER": 1, "COL": 7}
        executed = [(q, p) for cur in conn.cursors for q, p in cur.executed]
        assert any("INSERT INTO teams" in q and p[:2] == (10, "alpine") for q, p in executed)
        assert any("INSERT INTO drivers" in q and p[:4] == (10, 101, 43, "COL") for q, p in executed)

    def test_a_known_driver_matched_by_code_is_not_inserted_again(self):
        conn = FakeConnection([
            [{"id": 100, "team_key": "red_bull_racing"}],
            [{"id": 1, "code": "VER", "first_name": "Max", "last_name": "Verstappen"}],
        ])

        assert register_session_drivers(conn, 10, [_entry(first="M.", last="Verstappen")]) == {"VER": 1}
        assert not any("INSERT" in q for cur in conn.cursors for q, _ in cur.executed)

    def test_update_existing_refreshes_team_and_number_of_known_drivers(self):
        conn = FakeConnection([
            [{"id": 100, "team_key": "red_bull_racing"}, {"id": 200, "team_key": "racing_bulls"}],
            [{"id": 1, "code": "LAW", "first_name": "Liam", "last_name": "Lawson"}],
        ])

        register_session_drivers(conn, 10, [_entry(code="LAW", number=30, first="Liam", last="Lawson", team="racing_bulls")],
                                 update_existing=True)

        updates = [p for cur in conn.cursors for q, p in cur.executed if q.startswith("UPDATE drivers")]
        assert updates == [(200, 30, "Liam", "Lawson", None, 1)]
