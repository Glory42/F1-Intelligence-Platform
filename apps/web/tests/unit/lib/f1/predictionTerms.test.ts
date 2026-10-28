import { describe, expect, test } from 'vitest';
import { softmax } from '../../../../src/lib/f1/predictionMath';
import { edgeBreakdown, fieldScaled, termsOf, whatIfProbabilities } from '../../../../src/lib/f1/predictionTerms';

describe('termsOf', () => {
  test('a driver\'s terms are the served contributions, one per feature, whichever model', () => {
    expect(termsOf({ grid: { value: -1.1, contribution: 0.5 }, carPerformance: { value: 0.8, contribution: 0.67 } }))
      .toEqual({ grid: 0.5, carPerformance: 0.67 });
  });
});

describe('edgeBreakdown', () => {
  test('measures each feature against the field average and shares out only the positive edges', () => {
    const winner = { grid: 1.0, pace: 0.2, form: -0.4 };
    const field = [winner, { grid: 0.0, pace: 0.0, form: 0.4 }];

    const result = edgeBreakdown(winner, field);

    expect(result.map((r) => r.key)).toEqual(['grid', 'pace', 'form']);
    expect(result.map((r) => r.edge)).toEqual([0.5, 0.1, -0.4].map((e) => expect.closeTo(e, 10)));
    expect(result.map((r) => r.share)).toEqual([5 / 6, 1 / 6, 0].map((e) => expect.closeTo(e, 10)));
  });

  test('a driver with no edge anywhere gets zero shares, not a division by zero', () => {
    const same = { grid: 0.3 };
    expect(edgeBreakdown(same, [same, same]).every((r) => r.share === 0)).toBe(true);
  });
});

describe('fieldScaled', () => {
  test('rescales each feature to 0–1 across the field, best at 1', () => {
    expect(fieldScaled([{ grid: 2, pace: 1 }, { grid: 0, pace: 1 }, { grid: 1, pace: 1 }])).toEqual([
      { grid: 1, pace: 0.5 },
      { grid: 0, pace: 0.5 },
      { grid: 0.5, pace: 0.5 },
    ]);
  });
});

describe('whatIfProbabilities', () => {
  const field = [{ grid: 1.0, form: 0.0 }, { grid: 0.0, form: 0.5 }];
  const model = { grid: 60, form: 40 };

  test('at the model\'s own weights it gives back the model\'s probabilities', () => {
    expect(whatIfProbabilities(field, model, model)).toEqual(softmax([1.0, 0.5]));
  });

  test('turning a feature off removes its term', () => {
    expect(whatIfProbabilities(field, model, { grid: 0, form: 40 })).toEqual(
      softmax([0, 0.5 * (100 / 40)]),
    );
  });

  test('raising every weight equally changes nothing', () => {
    expect(whatIfProbabilities(field, model, { grid: 120, form: 80 })).toEqual(softmax([1.0, 0.5]));
  });

  test('all weights at zero leaves an even split', () => {
    expect(whatIfProbabilities(field, model, { grid: 0, form: 0 })).toEqual([0.5, 0.5]);
  });
});
