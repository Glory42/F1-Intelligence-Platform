import { describe, expect, it } from 'bun:test';
import { thinTrace, trackProfile } from '../../../../src/modules/circuits/track-profile.helpers';

// Builds a 10 m-grid lap from segments, the way ingest_qualifying_telemetry stores it.
function lap(segments: Array<{ m: number; speed: number; throttle: number; brake?: number }>) {
  const s = { distanceM: [] as number[], speed: [] as number[], throttle: [] as number[], brake: [] as number[] };
  for (const seg of segments) {
    for (let i = 0; i < seg.m / 10; i++) {
      s.distanceM.push(s.distanceM.length * 10);
      s.speed.push(seg.speed);
      s.throttle.push(seg.throttle);
      s.brake.push(seg.brake ?? 0);
    }
  }
  return s;
}

const LAP = lap([
  { m: 600, speed: 300, throttle: 100 },
  { m: 50, speed: 150, throttle: 0, brake: 100 },
  { m: 30, speed: 90, throttle: 20 },
  { m: 300, speed: 280, throttle: 100 },
  { m: 40, speed: 180, throttle: 50 },
  { m: 200, speed: 290, throttle: 100 },
  { m: 30, speed: 250, throttle: 0, brake: 100 },
  { m: 20, speed: 230, throttle: 60 },
  { m: 100, speed: 270, throttle: 100 },
]);

describe('trackProfile', () => {
  it('measures full throttle, the longest flat-out run, top speed and braking zones', () => {
    const p = trackProfile(LAP);

    expect(p.fullThrottlePct).toBe(88);
    expect(p.longestFullThrottleM).toBe(600);
    expect(p.topSpeedKph).toBe(300);
    expect(p.brakingZones).toBe(2);
  });

  it('counts each lift or brake as one corner, classed by its slowest point', () => {
    expect(trackProfile(LAP).corners).toEqual({ low: 1, medium: 1, high: 1 });
  });
});

describe('thinTrace', () => {
  it('keeps one sample every N metres', () => {
    const thin = thinTrace(LAP, 50);

    expect(thin.distanceM.slice(0, 3)).toEqual([0, 50, 100]);
    expect(thin.speed.length).toBe(thin.distanceM.length);
  });
});
