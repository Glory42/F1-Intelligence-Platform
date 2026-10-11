interface StopDriver {
  id: number;
}

export interface DriverStopSummary<D extends StopDriver> {
  driver: D;
  stops: number;
  medianMs: number;
  bestMs: number;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

export function driverStopSummaries<D extends StopDriver>(stops: Array<{ driver: D; stationaryMs: number }>): DriverStopSummary<D>[] {
  const byDriver = new Map<number, { driver: D; times: number[] }>();
  for (const s of stops) {
    const entry = byDriver.get(s.driver.id) ?? { driver: s.driver, times: [] };
    entry.times.push(s.stationaryMs);
    byDriver.set(s.driver.id, entry);
  }
  return [...byDriver.values()]
    .map(({ driver, times }) => ({ driver, stops: times.length, medianMs: median(times), bestMs: Math.min(...times) }))
    .sort((a, b) => a.medianMs - b.medianMs);
}
