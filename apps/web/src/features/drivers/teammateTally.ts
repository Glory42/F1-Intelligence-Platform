interface Outing {
  qualiPosition: number | null;
  finishPosition: number | null;
  status: string | null;
}

export interface DriverTally {
  podiums: number;
  retirements: number;
  avgQuali: number | null;
  avgFinish: number | null;
  bestFinish: number | null;
}

// Same rule as the API's isClassifiedFinish (docs/adr/0002): DSQ and DNS are non-finishes too.
export const isClassified = (status: string | null) =>
  status != null && (status === 'Finished' || status === 'Lapped' || /^\+\d+ Laps?$/.test(status));

const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

function tally(outings: Outing[]): DriverTally {
  const finishes = outings.filter((o) => isClassified(o.status) && o.finishPosition != null).map((o) => o.finishPosition!);
  return {
    podiums: finishes.filter((p) => p <= 3).length,
    retirements: outings.length - finishes.length,
    avgQuali: average(outings.map((o) => o.qualiPosition).filter((p): p is number => p != null)),
    avgFinish: average(finishes),
    bestFinish: finishes.length ? Math.min(...finishes) : null,
  };
}

export function teammateTally(races: Array<{ driver: Outing; teammate: Outing }>): { driver: DriverTally; teammate: DriverTally } {
  return { driver: tally(races.map((r) => r.driver)), teammate: tally(races.map((r) => r.teammate)) };
}
