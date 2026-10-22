import { describe, expect, test } from 'vitest';
import { softmax, SPRINT_SOFTMAX_TEMPERATURE } from '../../../../src/lib/f1/predictionMath';
import {
  edgeBreakdown,
  fieldScaled,
  gpTerms,
  sprintTerms,
  whatIfProbabilities,
} from '../../../../src/lib/f1/predictionTerms';
import type { GpFeatures, SprintFeatureScores } from '../../../../src/types';

const term = (contribution: number) => ({ value: 0, contribution });
const gpFeatures: GpFeatures = {
  grid: term(0.5), qualiPace: term(0.2), teamQualiPace: term(0.1), driverPoints: term(0.4),
  teammateEdge: term(0), gridProcessional: term(0.3), teamRacePace: term(-0.1),
};

describe('gpTerms', () => {
  test('a GP driver\'s terms are the stored contributions, one per feature', () => {
    expect(gpTerms(gpFeatures)).toEqual({
      grid: 0.5, qualiPace: 0.2, teamQualiPace: 0.1, driverPoints: 0.4,
      teammateEdge: 0, gridProcessional: 0.3, teamRacePace: -0.1,
    });
  });
});

describe('sprintTerms', () => {
  const scores = (car: string, grid: string) =>
    ({ carPerformance: car, circuitAdjStartPos: grid }) as unknown as SprintFeatureScores;

  test('reproduces sprint-v2: softmax of summed terms equals its weighted score at T=0.3', () => {
    const weights = { carPerformance: 50, circuitAdjStartPos: 50 };
    const a = sprintTerms(scores('0.9', '0.5'), weights);
    const b = sprintTerms(scores('0.4', '0.8'), weights);
    const sum = (t: Record<string, number>) => Object.values(t).reduce((x, y) => x + y, 0);

    expect(softmax([sum(a), sum(b)])).toEqual(
      softmax([0.5 * 0.9 + 0.5 * 0.5, 0.5 * 0.4 + 0.5 * 0.8], SPRINT_SOFTMAX_TEMPERATURE).map(
        (p) => expect.closeTo(p, 10),
      ),
    );
  });

  test('a missing score counts as zero', () => {
    expect(sprintTerms(scores('0.5', '0.5'), { carPerformance: 50, sqQualifyingDelta: 50 }).sqQualifyingDelta).toBe(0);
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
