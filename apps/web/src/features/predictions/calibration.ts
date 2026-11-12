import type { SeasonAccuracy } from '@/types';

export type CalibrationPoint = { from: number; predictions: number; meanPredicted: number; actualRate: number };

type Band = { from: number; predictions: number; wins: number; probabilitySum: number };

// The API bins each season; summed over every season the high bands, where few drivers ever sit, get
// enough of them to read.
export function combineCalibration(seasons: SeasonAccuracy[]): { races: number; points: CalibrationPoint[] } {
  const bands = new Map<number, Band>();
  let races = 0;
  for (const { calibration } of seasons) {
    if (!calibration) continue;
    races += calibration.races;
    for (const bin of calibration.bins) {
      const key = Math.round(bin.from * 10);
      const band = bands.get(key) ?? { from: bin.from, predictions: 0, wins: 0, probabilitySum: 0 };
      band.predictions += bin.predictions;
      band.wins += bin.wins;
      band.probabilitySum += bin.probabilitySum;
      bands.set(key, band);
    }
  }
  const points = [...bands.values()]
    .sort((a, b) => a.from - b.from)
    .map((band) => ({
      from: band.from,
      predictions: band.predictions,
      meanPredicted: band.probabilitySum / band.predictions,
      actualRate: band.wins / band.predictions,
    }));
  return { races, points };
}
