interface HighlightDriver {
  id: number;
}

interface FinishRow<D extends HighlightDriver> {
  finishPosition: number | null;
  fastestLap: boolean;
  driver: D;
}

interface GridRow<D extends HighlightDriver> {
  gridPosition: number;
  driver: D;
}

export interface RaceHighlights<D extends HighlightDriver, R extends FinishRow<D>> {
  podium: R[];
  pole: D | null;
  fastestLap: D | null;
  retirements: number;
}

export function raceHighlights<D extends HighlightDriver, R extends FinishRow<D>>(
  results: R[],
  qualifying: GridRow<D>[],
): RaceHighlights<D, R> {
  const podium = results
    .filter((r) => r.finishPosition != null && r.finishPosition <= 3)
    .sort((a, b) => a.finishPosition! - b.finishPosition!);
  return {
    podium,
    pole: qualifying.find((q) => q.gridPosition === 1)?.driver ?? null,
    fastestLap: results.find((r) => r.fastestLap)?.driver ?? null,
    retirements: results.filter((r) => r.finishPosition == null).length,
  };
}
