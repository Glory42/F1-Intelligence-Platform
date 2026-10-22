"""A small in-memory RaceHistory for the v4 feature, model and job tests."""
from datetime import date

from src.utils.race_history import RaceHistory


def quali_row(driver_id, team_id, grid, q1=None, q2=None, q3=None):
    return {"driver_id": driver_id, "team_id": team_id, "grid_position": grid,
            "q1_time_ms": q1, "q2_time_ms": q2, "q3_time_ms": q3}


def result_row(driver_id, team_id, finish, status="Finished", grid=None):
    return {"driver_id": driver_id, "team_id": team_id, "finish_position": finish, "status": status,
            "grid_position": grid}


def race_row(race_id, day, status="completed", circuit_id=1, neutralised=False, overtake_rate=0.5, year=None):
    return {"id": race_id, "race_date": day, "year": year or day.year, "status": status, "event_format": "conventional",
            "circuit_id": circuit_id, "overtake_rate": overtake_rate, "neutralised": neutralised}


def sample_history(**overrides) -> RaceHistory:
    """Two completed races, then race 3 to predict. Team 10 (drivers 1, 2) is the fast car; driver 1
    beat driver 2 both times; team 20 (driver 3) is slow. Driver 4 is a rookie in team 20."""
    base = dict(
        races={
            1: race_row(1, date(2026, 3, 1)),
            2: race_row(2, date(2026, 3, 15), neutralised=True),
            3: race_row(3, date(2026, 4, 1), status="qualifying_done", overtake_rate=0.2),
        },
        results={
            1: [result_row(1, 10, 1), result_row(2, 10, 2), result_row(3, 20, 3)],
            2: [result_row(1, 10, 1), result_row(2, 10, None, status="Engine"), result_row(3, 20, 2)],
        },
        quali={
            1: [quali_row(1, 10, 1, 80000, 79000, 78000), quali_row(2, 10, 2, 80100, 79100, 78390), quali_row(3, 20, 3, 81000)],
            2: [quali_row(1, 10, 1, 80000, 79000, 78000), quali_row(2, 10, 2, 80100, 79100, 78780), quali_row(3, 20, 3, 81000)],
            3: [quali_row(1, 10, 1, 80000, 79000, 78000), quali_row(2, 10, 2, 80100, 79100, 78156), quali_row(3, 20, 3, 81000),
                quali_row(4, 20, None)],
        },
        long_runs={},
        sprints={},
        race_pace={1: [{"driver_id": 1, "median_lap_ms": 90000}, {"driver_id": 3, "median_lap_ms": 91800}]},
        person={1: "max", 2: "checo", 3: "nico", 4: "rookie"},
        outfit={10: "red_bull", 20: "haas"},
        team_of={1: 10, 2: 10, 3: 20, 4: 20},
    )
    base.update(overrides)
    return RaceHistory(**base)
