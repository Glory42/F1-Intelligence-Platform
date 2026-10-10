import { describe, expect, it } from 'vitest';
import { spreadLabels } from '@/lib/labelLayout';

describe('spreadLabels', () => {
  it('pushes crowded labels apart by the minimum gap, keeping their order', () => {
    expect(spreadLabels([100, 103, 104], 10, 0, 500)).toEqual([100, 110, 120]);
  });

  it('keeps labels inside the chart by shifting the stack up from the bottom edge', () => {
    expect(spreadLabels([498, 495], 10, 0, 500)).toEqual([500, 490]);
  });

  it('leaves labels that already have room untouched', () => {
    expect(spreadLabels([20, 200, 60], 10, 0, 500)).toEqual([20, 200, 60]);
  });
});
