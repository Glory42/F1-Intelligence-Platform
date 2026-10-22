import { describe, expect, test } from 'vitest';
import { PREDICTION_COPY } from '@/features/predictions/predictionCopy';

describe('PREDICTION_COPY', () => {
  test('gp wording', () => {
    const c = PREDICTION_COPY.gp;
    expect(c.pageTitle('Italian Grand Prix')).toBe('Italian Grand Prix Prediction');
    expect(c.fallbackTitle).toBe('Race Prediction');
    expect(c.kicker(5)).toBe('./round-05');
    expect(c.notFoundMessage).toBe('No prediction for this race');
    expect(c.fetchErrorMessage).toBe('No prediction available for this race');
    expect(c.actualLabel).toBe('actual winner');
    expect(c.actualWinnerLabel).toBe('actual winner');
    expect(c.gridColLabel).toBe('Qual Pos');
    expect(c.weightsHeading).toBe('./model weights');
    expect(c.weightsNote).toContain('Fitted to every Grand Prix since 2010');
    expect(c.sliderMax).toBe(40);
  });

  test('sprint wording', () => {
    const c = PREDICTION_COPY.sprint;
    expect(c.pageTitle('Italian Grand Prix')).toBe('Sprint Prediction · Italian Grand Prix');
    expect(c.fallbackTitle).toBe('Sprint Prediction');
    expect(c.kicker(5)).toBe('./round-05 · sprint prediction');
    expect(c.notFoundMessage).toBe('No sprint prediction for this race');
    expect(c.fetchErrorMessage).toBe('No sprint prediction available for this race');
    expect(c.actualLabel).toBe('actual sprint winner');
    expect(c.actualWinnerLabel).toBe('sprint winner');
    expect(c.gridColLabel).toBe('Grid');
    expect(c.weightsHeading).toBe('./sprint weights');
    expect(c.weightsNote).toContain('Grid position weighted higher');
    expect(c.sliderMax).toBe(35);
  });
});
