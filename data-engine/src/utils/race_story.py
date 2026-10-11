from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass, field


@dataclass
class LapTrace:
    positions: list[int] = field(default_factory=list)
    gaps_ms: list[int | None] = field(default_factory=list)
    intervals_ms: list[int | None] = field(default_factory=list)
    laps_down: list[int] = field(default_factory=list)


def build_lap_traces(laps: list[dict]) -> dict[str, LapTrace]:
    """laps: one record per driver lap, driver, lap, position, time_ms (session time at lap end)."""
    time_at: dict[tuple[int, int], int] = {(lap["lap"], lap["position"]): lap["time_ms"] for lap in laps}
    leader_lap_ends = sorted(t for (_, position), t in time_at.items() if position == 1)

    traces: dict[str, LapTrace] = defaultdict(LapTrace)
    for lap in sorted(laps, key=lambda l: (l["driver"], l["lap"])):
        trace = traces[lap["driver"]]
        trace.positions.append(lap["position"])
        # Laps the leader had completed by the time this car crossed the line, beyond its own.
        laps_down = max(0, bisect_right(leader_lap_ends, lap["time_ms"]) - lap["lap"])
        trace.laps_down.append(laps_down)
        leader = time_at.get((lap["lap"], 1))
        trace.gaps_ms.append(None if laps_down or leader is None else lap["time_ms"] - leader)
        ahead = time_at.get((lap["lap"], lap["position"] - 1))
        trace.intervals_ms.append(None if ahead is None else lap["time_ms"] - ahead)
    return dict(traces)


BATTLE_GAP_MS = 1_000
BATTLE_MIN_LAPS = 3


@dataclass(frozen=True)
class Battle:
    chaser: str
    leader: str
    lap_start: int
    lap_end: int
    min_gap_ms: int


def find_battles(traces: dict[str, LapTrace]) -> list[Battle]:
    """A battle = BATTLE_MIN_LAPS+ consecutive laps within BATTLE_GAP_MS of the same car ahead."""
    driver_at = {(lap + 1, pos): code for code, t in traces.items() for lap, pos in enumerate(t.positions)}
    battles: list[Battle] = []
    for code, trace in traces.items():
        run: list[tuple[int, str, int]] = []
        for lap_index, (pos, interval) in enumerate(zip(trace.positions, trace.intervals_ms)):
            lap = lap_index + 1
            ahead = driver_at.get((lap, pos - 1))
            close = interval is not None and interval <= BATTLE_GAP_MS and ahead is not None
            if close and (not run or run[-1][1] == ahead):
                run.append((lap, ahead, interval))
                continue
            battles.extend(_close_run(code, run))
            run = [(lap, ahead, interval)] if close else []
        battles.extend(_close_run(code, run))
    return sorted(battles, key=lambda b: (b.lap_start, b.chaser))


def _close_run(chaser: str, run: list[tuple[int, str, int]]) -> list[Battle]:
    if len(run) < BATTLE_MIN_LAPS:
        return []
    return [Battle(chaser=chaser, leader=run[0][1], lap_start=run[0][0], lap_end=run[-1][0],
                   min_gap_ms=min(gap for _, _, gap in run))]


@dataclass(frozen=True)
class WeatherTrace:
    minute_offsets: list[int]
    air_temp_tenths: list[int]
    track_temp_tenths: list[int]
    rainfall: list[bool]


def weather_trace(weather) -> WeatherTrace:
    """FastF1 session.weather_data (one sample a minute) → arrays; temps as integer tenths of °C."""
    start = weather["Time"].iloc[0]
    return WeatherTrace(
        minute_offsets=[round((t - start).total_seconds() / 60) for t in weather["Time"]],
        air_temp_tenths=[round(v * 10) for v in weather["AirTemp"]],
        track_temp_tenths=[round(v * 10) for v in weather["TrackTemp"]],
        rainfall=[bool(v) for v in weather["Rainfall"]],
    )
