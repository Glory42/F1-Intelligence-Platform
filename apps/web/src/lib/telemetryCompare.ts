interface TimedLap {
  timeMs: number[];
}

export type SectorWinner = 'a' | 'b';

// Both laps are resampled onto the same 10 m grid by the data engine, so indexes line up.
export function lapDelta(a: TimedLap, b: TimedLap): number[] {
  const n = Math.min(a.timeMs.length, b.timeMs.length);
  return Array.from({ length: n }, (_, i) => a.timeMs[i] - b.timeMs[i]);
}

export function sectorBounds(points: number, sectors: number): Array<[number, number]> {
  const last = points - 1;
  return Array.from({ length: sectors }, (_, k) => [Math.round((k * last) / sectors), Math.round(((k + 1) * last) / sectors)]);
}

export function miniSectorWinners(a: TimedLap, b: TimedLap, sectors: number): SectorWinner[] {
  const n = Math.min(a.timeMs.length, b.timeMs.length);
  return sectorBounds(n, sectors).map(([from, to]) =>
    a.timeMs[to] - a.timeMs[from] <= b.timeMs[to] - b.timeMs[from] ? 'a' : 'b',
  );
}
