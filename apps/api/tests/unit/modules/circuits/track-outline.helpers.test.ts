import { describe, expect, it } from 'bun:test';
import { buildOutlinePath } from '../../../../src/modules/circuits/track-outline.helpers';

describe('buildOutlinePath', () => {
  it('scales the lap into a square viewBox and flips y, since telemetry y points up but SVG y points down', () => {
    expect(buildOutlinePath([0, 10, 10, 0], [0, 0, 10, 10], 1000)).toBe('M0,1000L1000,1000L1000,0L0,0Z');
  });

  it('keeps the aspect ratio and centres the narrower axis', () => {
    expect(buildOutlinePath([0, 20, 20, 0], [0, 0, 10, 10], 1000)).toBe('M0,750L1000,750L1000,250L0,250Z');
  });
});
