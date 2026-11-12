import { describe, expect, test } from 'vitest';
import {
  softmax,
  confidenceTier,
  driverPredictionRecord,
  bestCall,
  worstMiss,
  longestStreak,
} from '../../../../src/lib/f1/predictionMath';

describe('softmax', () => {
  test('produces a probability distribution that sums to 1', () => {
    const probs = softmax([2, 5, 1, 3]);
    const sum = probs.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  test('splits evenly when all scores are equal', () => {
    expect(softmax([4, 4, 4])).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  test('assigns more probability to the higher score', () => {
    const [low, high] = softmax([1, 2]);
    expect(high).toBeGreaterThan(low);
  });

  test('is a plain softmax by default: log-odds 1 vs 0 gives the logistic sigmoid', () => {
    const [, high] = softmax([0, 1]);
    expect(high).toBeCloseTo(0.7310585786, 9);
  });

  test('a temperature divides the scores first', () => {
    expect(softmax([0, 0.3], 0.3)).toEqual(softmax([0, 1]));
  });
});

describe('confidenceTier', () => {
  test('a wide gap between the top two probabilities is a lock', () => {
    expect(confidenceTier(0.7, 0.15)).toBe('lock');
  });

  test('a moderate gap is a likely call', () => {
    expect(confidenceTier(0.4, 0.25)).toBe('likely');
  });

  test('a narrow gap is a toss-up', () => {
    expect(confidenceTier(0.28, 0.24)).toBe('tossup');
  });

  test('a gap comfortably past the lock threshold is a lock', () => {
    expect(confidenceTier(0.6, 0.35)).toBe('lock');
  });

  test('a gap just past the likely threshold is a likely call', () => {
    expect(confidenceTier(0.4, 0.3)).toBe('likely');
  });

  test('treats a missing runner-up as a lock', () => {
    expect(confidenceTier(0.9, undefined)).toBe('lock');
  });
});

describe('driverPredictionRecord', () => {
  const row = (roundNumber: number, predictedId: number, correct: boolean | null) => ({
    raceId: roundNumber * 10,
    raceName: `Round ${roundNumber}`,
    roundNumber,
    isSprint: false,
    predictedWinner: { id: predictedId },
    correct,
  });

  const history = [
    row(5, 7, true),
    row(1, 7, true),
    row(2, 9, false),
    row(3, 7, false),
    row(4, 7, null),
  ];

  test('counts how often the model tipped the driver and how often it was right', () => {
    const record = driverPredictionRecord(history, 7);
    expect(record.tipped).toBe(4);
    expect(record.decided).toBe(3);
    expect(record.correct).toBe(2);
  });

  test('lists the tipped races in round order, keeping pending ones', () => {
    const record = driverPredictionRecord(history, 7);
    expect(record.races.map((r) => r.roundNumber)).toEqual([1, 3, 4, 5]);
    expect(record.races.find((r) => r.roundNumber === 4)?.correct).toBeNull();
  });

  test('is empty when the model never tipped the driver', () => {
    const record = driverPredictionRecord(history, 42);
    expect(record).toEqual({ tipped: 0, decided: 0, correct: 0, races: [] });
  });
});

describe('recap derivations', () => {
  describe('bestCall', () => {
    test('is the correct prediction the model was least confident about', () => {
      const items = [
        { raceName: 'A', winProbability: '0.6', correct: true },
        { raceName: 'B', winProbability: '0.3', correct: true },
        { raceName: 'C', winProbability: '0.9', correct: false },
        { raceName: 'D', winProbability: '0.2', correct: null },
      ];
      expect(bestCall(items)?.raceName).toBe('B');
    });

    test('is null when no prediction was correct', () => {
      expect(bestCall([{ winProbability: '0.5', correct: false }])).toBeNull();
    });
  });

  describe('worstMiss', () => {
    test('is the wrong prediction the model was most confident about', () => {
      const items = [
        { raceName: 'A', winProbability: '0.6', correct: false },
        { raceName: 'B', winProbability: '0.85', correct: false },
        { raceName: 'C', winProbability: '0.9', correct: true },
      ];
      expect(worstMiss(items)?.raceName).toBe('B');
    });

    test('is null when every prediction was correct', () => {
      expect(worstMiss([{ winProbability: '0.9', correct: true }])).toBeNull();
    });
  });

  describe('longestStreak', () => {
    test('counts the longest run of consecutive correct calls in round order', () => {
      const items = [
        { roundNumber: 4, correct: true },
        { roundNumber: 1, correct: true },
        { roundNumber: 2, correct: true },
        { roundNumber: 3, correct: false },
        { roundNumber: 5, correct: true },
        { roundNumber: 6, correct: true },
      ];
      expect(longestStreak(items)).toBe(3);
    });

    test('a pending race resets the streak', () => {
      const items = [
        { roundNumber: 1, correct: true },
        { roundNumber: 2, correct: true },
        { roundNumber: 3, correct: null },
        { roundNumber: 4, correct: true },
        { roundNumber: 5, correct: true },
        { roundNumber: 6, correct: true },
        { roundNumber: 7, correct: true },
      ];
      expect(longestStreak(items)).toBe(4);
    });

    test('is 0 for an empty history', () => {
      expect(longestStreak([])).toBe(0);
    });
  });
});
