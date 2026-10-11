import { describe, expect, it } from 'vitest';
import { projectTrack } from '@/features/telemetry/trackMap';

describe('projectTrack', () => {
  it('fits the lap into a square viewBox, centring the narrow axis and flipping y for SVG', () => {
    expect(projectTrack([0, 20, 20, 0], [0, 0, 10, 10], 1000)).toEqual([
      [0, 750], [1000, 750], [1000, 250], [0, 250],
    ]);
  });
});
