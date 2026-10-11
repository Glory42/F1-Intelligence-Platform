interface GridEntry {
  driverId: number;
  gridPosition: number | null;
  driver: { code: string };
}

export interface GridDrop {
  code: string;
  qualified: number;
  started: number | null;
  places: number | null;
  pitLane: boolean;
}

// Moving up the grid only means someone ahead was penalised, so only drops are reported.
// FastF1 records a pit-lane start as grid position 0.
export function gridDrops(results: GridEntry[], qualifying: GridEntry[]): GridDrop[] {
  const qualified = new Map(qualifying.map((q) => [q.driverId, q.gridPosition]));
  return results.flatMap((r): GridDrop[] => {
    const q = qualified.get(r.driverId);
    if (q == null || r.gridPosition == null) return [];
    if (r.gridPosition === 0) return [{ code: r.driver.code, qualified: q, started: null, places: null, pitLane: true }];
    if (r.gridPosition <= q) return [];
    return [{ code: r.driver.code, qualified: q, started: r.gridPosition, places: r.gridPosition - q, pitLane: false }];
  });
}
