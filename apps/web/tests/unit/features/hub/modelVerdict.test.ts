import { describe, expect, it } from 'vitest';
import { modelVerdict } from '@/features/hub/modelVerdict';

const call = (raceId: number, correct: boolean | null, extra: Partial<{ isSprint: boolean; winProbability: string; actualWinnerPredictedPosition: number | null }> = {}) => ({
  raceId, correct, isSprint: false, winProbability: '0.41000', actualWinnerPredictedPosition: correct ? 1 : 3,
  predictedWinner: { code: 'RUS' }, ...extra,
});

describe('modelVerdict', () => {
  it("describes the model's grand prix call for the race and its season tally", () => {
    const history = [call(1, true), call(2, false), call(2, true, { isSprint: true }), call(3, true), call(4, null)];

    expect(modelVerdict(history, 3)).toEqual({
      pick: { code: 'RUS' }, probability: 0.41, hit: true, winnerRank: 1, seasonCorrect: 2, seasonDecided: 3,
    });
  });

  it("ranks the actual winner in the model's order when it missed", () => {
    const verdict = modelVerdict([call(2, false)], 2);

    expect(verdict?.hit).toBe(false);
    expect(verdict?.winnerRank).toBe(3);
  });

  it('has no verdict when the model made no grand prix call for the race', () => {
    expect(modelVerdict([call(2, true, { isSprint: true })], 2)).toBeNull();
  });
});
