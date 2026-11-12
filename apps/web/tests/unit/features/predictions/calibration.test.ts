import { describe, expect, test } from 'vitest';
import { combineCalibration } from '../../../../src/features/predictions/calibration';
import type { SeasonAccuracy, SeasonCalibration } from '../../../../src/types';

const bucket = { races: 0, correct: 0, accuracyPct: null };
const score = { brier: 0.5, logLoss: 1 };

function season(year: number, calibration: Partial<SeasonCalibration> | null): SeasonAccuracy {
  return {
    year, gp: bucket, sprint: bucket, overall: bucket,
    calibration: calibration && { races: 1, poleWinRate: 0.4, bins: [], model: score, pole: score, uniform: score, ...calibration },
  };
}

describe('combineCalibration', () => {
  test('sums each band across seasons into a mean prediction and an actual win rate', () => {
    const result = combineCalibration([
      season(2025, { races: 2, bins: [{ from: 0.1, predictions: 30, wins: 3, probabilitySum: 4.5 }] }),
      season(2024, {
        races: 3,
        bins: [
          { from: 0.1, predictions: 10, wins: 1, probabilitySum: 1.5 },
          { from: 0.7, predictions: 4, wins: 3, probabilitySum: 3 },
        ],
      }),
    ]);

    expect(result.races).toBe(5);
    expect(result.points).toEqual([
      { from: 0.1, predictions: 40, meanPredicted: 0.15, actualRate: 0.1 },
      { from: 0.7, predictions: 4, meanPredicted: 0.75, actualRate: 0.75 },
    ]);
  });

  test('skips seasons the model never scored', () => {
    expect(combineCalibration([season(2017, null)])).toEqual({ races: 0, points: [] });
  });
});
