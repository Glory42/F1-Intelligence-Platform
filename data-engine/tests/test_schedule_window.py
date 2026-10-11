from datetime import datetime, timedelta, timezone

import pandas as pd

from src.utils.schedule_window import RaceWeekendWindow, race_weekend_window


def _utc(year, month, day, hour=0, minute=0):
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


def _naive(dt):
    """FastF1 returns tz-naive pandas Timestamps that are implicitly UTC."""
    if dt is None:
        return pd.NaT
    return pd.Timestamp(dt.replace(tzinfo=None))


def _event(round_number, race_utc, *, fmt="conventional", sessions=None):
    """One schedule row shaped like fastf1.get_event_schedule(): default layout: FP1 two
    days before the race, FP2 +4h, FP3/Q the day before, R at race_utc."""
    if sessions is None:
        fp1 = race_utc - timedelta(days=2)
        sessions = [
            fp1,
            fp1 + timedelta(hours=4),
            race_utc - timedelta(days=1, hours=3),
            race_utc - timedelta(days=1),
            race_utc,
        ]
    return {
        "RoundNumber": round_number,
        "EventFormat": fmt,
        "EventDate": _naive(sessions[4]),
        "Session1DateUtc": _naive(sessions[0]),
        "Session2DateUtc": _naive(sessions[1]),
        "Session3DateUtc": _naive(sessions[2]),
        "Session4DateUtc": _naive(sessions[3]),
        "Session5DateUtc": _naive(sessions[4]),
    }


def _schedule(*events):
    return pd.DataFrame(list(events))


class TestRaceWeekendWindow:
    def test_returns_none_when_every_race_is_more_than_two_days_past(self):
        now = _utc(2026, 12, 20)
        schedule = _schedule(
            _event(23, _utc(2026, 11, 29, 14, 0)),
            _event(24, _utc(2026, 12, 6, 13, 0)),
        )

        assert race_weekend_window(schedule, now) is None

    def test_race_with_no_scheduled_race_time_is_not_selectable(self):
        now = _utc(2026, 1, 15, 12, 0)
        fp1 = _utc(2026, 3, 6, 1, 30)
        schedule = _schedule(
            _event(1, None, sessions=[fp1, fp1 + timedelta(hours=4), None, None, None]),
        )

        assert race_weekend_window(schedule, now) is None

    def test_window_start_ignores_nat_sessions(self):
        now = _utc(2026, 3, 4, 12, 0)
        fp1 = _utc(2026, 3, 6, 1, 30)
        race = _utc(2026, 3, 8, 4, 0)
        schedule = _schedule(
            _event(1, race, sessions=[fp1, None, None, race - timedelta(days=1), race]),
        )

        window = race_weekend_window(schedule, now)

        assert window is not None
        assert window.start == fp1 - timedelta(hours=1)

    def test_sprint_weekend_anchors_on_the_earliest_session_like_any_other(self):
        now = _utc(2026, 4, 22, 12, 0)
        fp1 = _utc(2026, 4, 24, 10, 30)  # Friday
        race = _utc(2026, 4, 26, 13, 0)  # Sunday
        schedule = _schedule(
            _event(
                5,
                race,
                fmt="sprint_qualifying",
                sessions=[
                    fp1,
                    fp1 + timedelta(hours=4),  # sprint qualifying
                    race - timedelta(days=1, hours=5),  # sprint
                    race - timedelta(days=1, hours=1),  # qualifying
                    race,
                ],
            ),
        )

        window = race_weekend_window(schedule, now)

        assert window is not None
        assert window.start == fp1 - timedelta(hours=1)
        assert window.end == race + timedelta(hours=24)

    def test_contains_is_inclusive_at_both_edges(self):
        window = RaceWeekendWindow(
            round_number=1,
            start=_utc(2026, 3, 6, 0, 30),
            end=_utc(2026, 3, 9, 4, 0),
        )

        assert window.contains(window.start) is True
        assert window.contains(window.end) is True
        assert window.contains(window.start - timedelta(seconds=1)) is False
        assert window.contains(window.end + timedelta(seconds=1)) is False

    def test_race_that_started_yesterday_is_still_the_current_weekend(self):
        race = _utc(2026, 7, 5, 13, 0)
        now = race + timedelta(days=1)  # Monday after Sunday's race
        schedule = _schedule(
            _event(12, race),
            _event(13, race + timedelta(days=14)),
        )

        window = race_weekend_window(schedule, now)

        assert window is not None
        assert window.round_number == 12

    def test_picks_the_nearest_upcoming_race_when_several_remain(self):
        now = _utc(2026, 5, 1, 12, 0)
        schedule = _schedule(
            _event(9, _utc(2026, 6, 7, 13, 0)),
            _event(7, _utc(2026, 5, 24, 13, 0)),
            _event(8, _utc(2026, 5, 31, 13, 0)),
        )

        window = race_weekend_window(schedule, now)

        assert window is not None
        assert window.round_number == 7

    def test_window_spans_one_hour_before_fp1_to_24h_after_the_race(self):
        now = _utc(2026, 3, 4, 12, 0)  # Wednesday before the race
        fp1 = _utc(2026, 3, 6, 1, 30)
        race = _utc(2026, 3, 8, 4, 0)
        schedule = _schedule(
            _event(
                1,
                race,
                sessions=[fp1, fp1 + timedelta(hours=4), race - timedelta(days=1, hours=3), race - timedelta(days=1), race],
            ),
        )

        window = race_weekend_window(schedule, now)

        assert window == RaceWeekendWindow(
            round_number=1,
            start=_utc(2026, 3, 6, 0, 30),
            end=_utc(2026, 3, 9, 4, 0),
        )
