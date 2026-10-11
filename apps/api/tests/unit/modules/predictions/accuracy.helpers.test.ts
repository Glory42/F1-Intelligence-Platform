import { describe, expect, test } from 'bun:test';
import { aggregateAccuracyBySeason } from '../../../../src/modules/predictions/accuracy.helpers';
import type { PredictionHistoryItem } from '../../../../src/common/types';

function item(overrides: Partial<PredictionHistoryItem>): PredictionHistoryItem {
  return {
    raceId: 1,
    raceName: 'Test GP',
    raceDate: '2025-06-01',
    roundNumber: 1,
    circuit: {} as PredictionHistoryItem['circuit'],
    predictedWinner: {} as PredictionHistoryItem['predictedWinner'],
    actualWinner: null,
    winProbability: '0.5',
    correct: null,
    actualWinnerPredictedPosition: null,
    computedAt: '2025-06-01T00:00:00.000Z',
    isSprint: false,
    ...overrides,
  };
}

describe('aggregateAccuracyBySeason', () => {
  test('groups by the year in raceDate', () => {
    const result = aggregateAccuracyBySeason([
      item({ raceDate: '2025-03-01', correct: true }),
      item({ raceDate: '2024-11-01', correct: false }),
    ]);
    expect(result.map((r) => r.year)).toEqual([2025, 2024]);
  });

  test('sorts seasons newest first', () => {
    const result = aggregateAccuracyBySeason([
      item({ raceDate: '2023-01-01', correct: true }),
      item({ raceDate: '2025-01-01', correct: true }),
      item({ raceDate: '2024-01-01', correct: true }),
    ]);
    expect(result.map((r) => r.year)).toEqual([2025, 2024, 2023]);
  });

  test('separates gp and sprint into their own buckets', () => {
    const [season] = aggregateAccuracyBySeason([
      item({ raceDate: '2025-01-01', isSprint: false, correct: true }),
      item({ raceDate: '2025-02-01', isSprint: true, correct: false }),
    ]);
    expect(season.gp).toEqual({ races: 1, correct: 1, accuracyPct: 100 });
    expect(season.sprint).toEqual({ races: 1, correct: 0, accuracyPct: 0 });
    expect(season.overall).toEqual({ races: 2, correct: 1, accuracyPct: 50 });
  });

  test('races with correct === null (not yet run) are excluded from the denominator', () => {
    const [season] = aggregateAccuracyBySeason([
      item({ raceDate: '2025-01-01', correct: true }),
      item({ raceDate: '2025-02-01', correct: null }),
    ]);
    expect(season.gp).toEqual({ races: 1, correct: 1, accuracyPct: 100 });
  });

  test('a bucket with no items (e.g. no sprints that season) has a null accuracyPct', () => {
    const [season] = aggregateAccuracyBySeason([item({ raceDate: '2025-01-01', isSprint: false, correct: true })]);
    expect(season.sprint).toEqual({ races: 0, correct: 0, accuracyPct: null });
  });

  test('a season with no decided races anywhere is excluded entirely', () => {
    const result = aggregateAccuracyBySeason([item({ raceDate: '2025-01-01', correct: null })]);
    expect(result).toEqual([]);
  });

  test('empty input returns an empty array', () => {
    expect(aggregateAccuracyBySeason([])).toEqual([]);
  });
});
