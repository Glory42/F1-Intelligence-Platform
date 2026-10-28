"""One lap's telemetry resampled onto a fixed distance grid, from either adapter's car and position samples."""
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Sequence

import numpy as np

if TYPE_CHECKING:
    from src.utils.session_records import CarSample, PositionSample


@dataclass(frozen=True)
class LapWindow:
    lap_number: int
    start: datetime
    lap_ms: int


@dataclass(frozen=True)
class LapTelemetry:
    distance_m: list[int]
    time_ms: list[int]
    speed: list[int]
    throttle: list[int]
    brake: list[int]
    gear: list[int]
    x: list[int]
    y: list[int]


def _seconds(samples: Sequence["CarSample | PositionSample"], start: datetime) -> np.ndarray:
    return np.array([(s.at - start).total_seconds() for s in samples])


def build_lap_telemetry(
    car_data: Sequence["CarSample"], location: Sequence["PositionSample"], window: LapWindow, track_length_m: float,
    step_m: int = 10,
) -> LapTelemetry:
    """Car samples have no distance channel: integrate speed over time (trapezoid), scale the
    total to the circuit length to cancel drift, then resample everything onto a fixed distance
    grid so two drivers' laps line up point for point. Ints only: compact JSONB in Neon."""
    # Pad with the lap's true start (t=0) and end (t=lap time), carrying the nearest sample's values:
    # car_data starts ~0.1 s after the line and stops short of it, which would otherwise skew deltas.
    lap_s = window.lap_ms / 1000
    inside = [c for c in car_data if 0 <= (c.at - window.start).total_seconds() <= lap_s]
    if len(inside) < 2:
        raise ValueError(f"too few car_data samples inside lap {window.lap_number}")
    samples = [inside[0], *inside, inside[-1]]
    t = np.concatenate([[0.0], _seconds(inside, window.start), [lap_s]])
    speed_ms = np.array([s.speed for s in samples], dtype=float) / 3.6
    raw = np.concatenate([[0.0], np.cumsum(np.diff(t) * (speed_ms[1:] + speed_ms[:-1]) / 2)])
    distance = raw * (track_length_m / raw[-1])
    grid = np.arange(0, track_length_m + 1e-9, step_m)

    def on_grid(values) -> list[int]:
        return [int(round(v)) for v in np.interp(grid, distance, np.asarray(values, dtype=float))]

    loc_t = _seconds(location, window.start)
    x_at_car = np.interp(t, loc_t, [p.x for p in location])
    y_at_car = np.interp(t, loc_t, [p.y for p in location])
    time_on_grid = np.interp(grid, distance, t)
    return LapTelemetry(
        distance_m=[int(round(g)) for g in grid],
        time_ms=[int(round(v * 1000)) for v in time_on_grid],
        speed=on_grid([s.speed for s in samples]),
        throttle=on_grid([s.throttle for s in samples]),
        brake=on_grid([100 if s.brake else 0 for s in samples]),
        gear=on_grid([s.gear for s in samples]),
        x=[int(round(v)) for v in np.interp(grid, distance, x_at_car)],
        y=[int(round(v)) for v in np.interp(grid, distance, y_at_car)],
    )


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.title() for part in rest)


def telemetry_samples(telemetry: LapTelemetry) -> dict[str, list[int]]:
    """The JSONB shape stored in qualifying_lap_telemetry.samples (camelCase keys, as the API reads)."""
    return {_camel(k): v for k, v in asdict(telemetry).items()}
