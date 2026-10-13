import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  weightedScore,
  softmax,
  contributions,
  confidenceTier,
  brierScore,
  calibrationBuckets,
  driverPredictionRecord,
  bestCall,
  worstMiss,
  longestStreak,
  GP_WEIGHTS,
  FEATURE_META,
  SPRINT_WEIGHTS,
  SPRINT_FEATURE_META,
  SOFTMAX_TEMPERATURE,
} from '../../../../src/lib/f1/predictionMath';

const __dirname = dirname(fileURLToPath(import.meta.url));
type FeatureManifestFixture = {
  softmax_temperature: number;
  gp: Record<string, { weight: number; label: string }>;
  sprint: Record<string, { weight: number; label: string }>;
};

const featureWeightsFixture: FeatureManifestFixture = JSON.parse(
  readFileSync(join(__dirname, '../../../../../../docs/feature-weights.json'), 'utf-8'),
);

// The shared fixture is snake_case (Python-native); FEATURE_META/SPRINT_FEATURE_META are camelCase.
function toSnakeCaseKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
      value,
    ]),
  );
}

describe('weightedScore', () => {
  test('sums weight times feature score over the weighted keys', () => {
    const score = weightedScore(
      { carPerformance: 0.5, longRunPace: 0.2 },
      { carPerformance: 20, longRunPace: 15 },
    );
    expect(score).toBe(13);
  });

  test('ignores feature keys that carry no weight', () => {
    const score = weightedScore(
      { carPerformance: 0.5, sectorStrength: 0.9 },
      { carPerformance: 20 },
    );
    expect(score).toBe(10);
  });

  test('treats a null or missing feature score as zero', () => {
    const score = weightedScore(
      { carPerformance: null },
      { carPerformance: 10, longRunPace: 8 },
    );
    expect(score).toBe(0);
  });

  test('accepts string feature scores as they arrive from the API', () => {
    const score = weightedScore(
      { carPerformance: '0.4', longRunPace: '0.5' },
      { carPerformance: 10, longRunPace: 10 },
    );
    expect(score).toBe(9);
  });
});

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

  test('matches the logistic sigmoid for a two-way split at the default T=0.3', () => {
    const [, high] = softmax([0, 0.3]);
    expect(high).toBeCloseTo(0.7310585786, 9);
  });

  test('defaults the temperature to 0.3', () => {
    expect(softmax([0, 1])).toEqual(softmax([0, 1], 0.3));
  });
});

describe('GP_WEIGHTS / FEATURE_META', () => {
  test('the GP model has 12 weighted features that sum to 100', () => {
    const values = Object.values(GP_WEIGHTS);
    expect(values).toHaveLength(12);
    expect(values.reduce((a, b) => a + b, 0)).toBe(100);
  });

  test('every weighted feature has display metadata', () => {
    for (const key of Object.keys(GP_WEIGHTS)) {
      expect(FEATURE_META[key]?.label).toBeTruthy();
    }
  });
});

describe('SPRINT_WEIGHTS / SPRINT_FEATURE_META', () => {
  test('the sprint model has 8 weighted features that sum to 100', () => {
    const values = Object.values(SPRINT_WEIGHTS);
    expect(values).toHaveLength(8);
    expect(values.reduce((a, b) => a + b, 0)).toBe(100);
  });

  test('every weighted sprint feature has display metadata', () => {
    for (const key of Object.keys(SPRINT_WEIGHTS)) {
      expect(SPRINT_FEATURE_META[key]?.label).toBeTruthy();
    }
  });
});

describe('docs/feature-weights.json (cross-language drift check)', () => {
  test('FEATURE_META weights and labels match the shared fixture', () => {
    expect(toSnakeCaseKeys(FEATURE_META)).toEqual(featureWeightsFixture.gp);
  });

  test('SPRINT_FEATURE_META weights and labels match the shared fixture', () => {
    expect(toSnakeCaseKeys(SPRINT_FEATURE_META)).toEqual(featureWeightsFixture.sprint);
  });

  test('SOFTMAX_TEMPERATURE matches the shared fixture', () => {
    expect(SOFTMAX_TEMPERATURE).toBe(featureWeightsFixture.softmax_temperature);
  });
});

describe('contributions', () => {
  test('returns weight times score per feature, sorted by contribution descending', () => {
    const result = contributions(
      { carPerformance: 0.2, longRunPace: 0.6 },
      { carPerformance: 20, longRunPace: 15 },
    );
    expect(result.map((c) => c.key)).toEqual(['longRunPace', 'carPerformance']);
    expect(result[0].contribution).toBeCloseTo(9, 10);
    expect(result[1].contribution).toBeCloseTo(4, 10);
  });

  test('shares are each feature contribution divided by the total, summing to 1', () => {
    const result = contributions(
      { carPerformance: 0.5, longRunPace: 0.2 },
      { carPerformance: 20, longRunPace: 15 },
    );
    const byKey = Object.fromEntries(result.map((c) => [c.key, c.share]));
    expect(byKey.carPerformance).toBeCloseTo(10 / 13, 10);
    expect(byKey.longRunPace).toBeCloseTo(3 / 13, 10);
    expect(result.reduce((a, c) => a + c.share, 0)).toBeCloseTo(1, 10);
  });

  test('only weighted keys appear in the breakdown', () => {
    const result = contributions(
      { carPerformance: 0.5, sectorStrength: 0.9 },
      { carPerformance: 20 },
    );
    expect(result.map((c) => c.key)).toEqual(['carPerformance']);
  });

  test('reports zero shares instead of dividing by zero when nothing contributes', () => {
    const result = contributions(
      { carPerformance: 0, longRunPace: 0 },
      { carPerformance: 20, longRunPace: 15 },
    );
    expect(result.every((c) => c.share === 0)).toBe(true);
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

describe('brierScore', () => {
  test('averages the squared error between win probability and outcome over completed races', () => {
    const score = brierScore([
      { winProbability: '0.6', correct: true },
      { winProbability: '0.4', correct: false },
    ]);
    expect(score).toBeCloseTo(0.16, 10);
  });

  test('ignores races that have no result yet', () => {
    const score = brierScore([
      { winProbability: '0.6', correct: true },
      { winProbability: '0.4', correct: false },
      { winProbability: '0.9', correct: null },
    ]);
    expect(score).toBeCloseTo(0.16, 10);
  });

  test('is null when no race has a result', () => {
    expect(brierScore([{ winProbability: '0.5', correct: null }])).toBeNull();
  });

  test('is null for an empty history', () => {
    expect(brierScore([])).toBeNull();
  });

  test('a perfectly confident correct call scores 0', () => {
    expect(brierScore([{ winProbability: '1', correct: true }])).toBe(0);
  });
});

describe('calibrationBuckets', () => {
  const history = [
    { winProbability: '0.10', correct: false },
    { winProbability: '0.15', correct: true },
    { winProbability: '0.55', correct: false },
    { winProbability: '0.65', correct: true },
    { winProbability: '0.70', correct: true },
    { winProbability: '0.90', correct: null },
  ];

  test('groups completed predictions into fixed-width probability bins', () => {
    const buckets = calibrationBuckets(history, 0.2);
    expect(buckets.map((b) => [b.lo, b.count])).toEqual([
      [0, 2],
      [0.4, 1],
      [0.6, 2],
    ]);
  });

  test('reports the mean predicted probability and actual hit rate per bin', () => {
    const buckets = calibrationBuckets(history, 0.2);
    const first = buckets.find((b) => b.lo === 0)!;
    expect(first.meanPredicted).toBeCloseTo(0.125, 10);
    expect(first.actualRate).toBeCloseTo(0.5, 10);
    const top = buckets.find((b) => b.lo === 0.6)!;
    expect(top.meanPredicted).toBeCloseTo(0.675, 10);
    expect(top.actualRate).toBe(1);
  });

  test('places a probability of 1.0 in the final bin', () => {
    const buckets = calibrationBuckets([{ winProbability: '1', correct: true }], 0.2);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].lo).toBeCloseTo(0.8, 10);
    expect(buckets[0].hi).toBeCloseTo(1, 10);
  });

  test('returns no buckets for an empty or all-pending history', () => {
    expect(calibrationBuckets([], 0.2)).toEqual([]);
    expect(calibrationBuckets([{ winProbability: '0.5', correct: null }], 0.2)).toEqual([]);
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
