import { describe, expect, test } from 'bun:test';
import { calibrationBySeason, type FieldProbability } from '../../../../src/modules/predictions/calibration.helpers';

const field = (raceId: number, year: number, probabilities: Record<number, number>): FieldProbability[] =>
  Object.entries(probabilities).map(([driverId, winProbability]) => ({ raceId, year, driverId: Number(driverId), winProbability }));

// Race 1: driver 1 on pole and wins. Race 2: driver 1 on pole, driver 2 wins.
const TWO_RACES = [...field(1, 2025, { 1: 0.6, 2: 0.3, 3: 0.1 }), ...field(2, 2025, { 1: 0.5, 2: 0.4, 3: 0.1 })];
const WINNERS = [{ raceId: 1, driverId: 1 }, { raceId: 2, driverId: 2 }];
const POLES = [{ raceId: 1, driverId: 1 }, { raceId: 2, driverId: 1 }];

describe('calibrationBySeason', () => {
  const season = calibrationBySeason(TWO_RACES, WINNERS, POLES).get(2025)!;

  test('scores the model over the whole field: Brier sums every driver, log loss reads the winner', () => {
    // Brier: (0.4² + 0.3² + 0.1²) and (0.5² + 0.6² + 0.1²) → 0.26, 0.62. Log loss: −ln 0.6, −ln 0.4.
    expect(season.races).toBe(2);
    expect(season.model.brier).toBeCloseTo(0.44, 4);
    expect(season.model.logLoss).toBeCloseTo((-Math.log(0.6) - Math.log(0.4)) / 2, 4);
  });

  test('the equal-chances baseline gives every driver 1/n', () => {
    expect(season.uniform.brier).toBeCloseTo(2 / 3, 4);
    expect(season.uniform.logLoss).toBeCloseTo(Math.log(3), 4);
  });

  test('the pole baseline gives the pole-sitter the share of races won from pole, the rest split evenly', () => {
    // Pole won 1 of 2 → 0.5 to pole, 0.25 each to the others.
    expect(season.poleWinRate).toBeCloseTo(0.5, 4);
    expect(season.pole.brier).toBeCloseTo((0.375 + 0.875) / 2, 4);
    expect(season.pole.logLoss).toBeCloseTo((-Math.log(0.5) - Math.log(0.25)) / 2, 4);
  });

  test('bins every driver’s probability in 10-point bands with how many of them won', () => {
    expect(season.bins).toEqual([
      { from: 0.1, predictions: 2, wins: 0, probabilitySum: 0.2 },
      { from: 0.3, predictions: 1, wins: 0, probabilitySum: 0.3 },
      { from: 0.4, predictions: 1, wins: 1, probabilitySum: 0.4 },
      { from: 0.5, predictions: 1, wins: 0, probabilitySum: 0.5 },
      { from: 0.6, predictions: 1, wins: 1, probabilitySum: 0.6 },
    ]);
  });

  test('keeps seasons apart', () => {
    const result = calibrationBySeason(
      [...field(1, 2024, { 1: 0.7, 2: 0.3 }), ...field(2, 2025, { 1: 0.2, 2: 0.8 })],
      [{ raceId: 1, driverId: 1 }, { raceId: 2, driverId: 2 }],
      [],
    );

    expect([...result.keys()].sort()).toEqual([2024, 2025]);
    expect(result.get(2024)!.races).toBe(1);
  });

  test('a race whose winner the model never scored, or without a result, is left out', () => {
    const result = calibrationBySeason(
      [...field(1, 2025, { 1: 0.7, 2: 0.3 }), ...field(2, 2025, { 1: 0.5, 2: 0.5 })],
      [{ raceId: 1, driverId: 9 }],
      [],
    );

    expect(result.has(2025)).toBe(false);
  });

  test('a winner the model rounded to 0 costs a large but finite log loss', () => {
    const result = calibrationBySeason(field(1, 2025, { 1: 1, 2: 0 }), [{ raceId: 1, driverId: 2 }], []);

    expect(result.get(2025)!.model.logLoss).toBeCloseTo(-Math.log(0.00001), 4);
  });

  test('without a known pole-sitter the pole baseline falls back to equal chances', () => {
    const result = calibrationBySeason(field(1, 2025, { 1: 0.7, 2: 0.3 }), [{ raceId: 1, driverId: 1 }], []);

    expect(result.get(2025)!.pole).toEqual(result.get(2025)!.uniform);
  });
});
