// Track character from one real qualifying lap on the 10 m grid ingest_qualifying_telemetry stores.
export interface LapChannels {
  distanceM: number[];
  speed: number[];
  throttle: number[];
  brake: number[];
}

export interface TrackProfile {
  fullThrottlePct: number;
  longestFullThrottleM: number;
  topSpeedKph: number;
  brakingZones: number;
  corners: { low: number; medium: number; high: number };
}

const FULL_THROTTLE = 98;
const LIFT = 90;
// A brief re-application between two lifts (a chicane) is still one corner.
const MERGE_GAP_SAMPLES = 5;
const LOW_SPEED_KPH = 130;
const HIGH_SPEED_KPH = 210;

function runs(flags: boolean[], mergeGap = 0): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  let start = -1;
  flags.forEach((on, i) => {
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      found.push([start, i - 1]);
      start = -1;
    }
  });
  if (start >= 0) found.push([start, flags.length - 1]);
  return found.reduce<Array<[number, number]>>((merged, run) => {
    const last = merged[merged.length - 1];
    if (last && run[0] - last[1] - 1 < mergeGap) last[1] = run[1];
    else merged.push([...run]);
    return merged;
  }, []);
}

export function trackProfile(lap: LapChannels): TrackProfile {
  const n = lap.speed.length;
  const spacing = n > 1 ? lap.distanceM[1] - lap.distanceM[0] : 0;
  const full = lap.throttle.map((t) => t >= FULL_THROTTLE);
  const fullRuns = runs(full);
  const corners = { low: 0, medium: 0, high: 0 };
  for (const [a, b] of runs(lap.throttle.map((t) => t < LIFT), MERGE_GAP_SAMPLES)) {
    const apex = Math.min(...lap.speed.slice(a, b + 1));
    if (apex < LOW_SPEED_KPH) corners.low += 1;
    else if (apex < HIGH_SPEED_KPH) corners.medium += 1;
    else corners.high += 1;
  }
  return {
    fullThrottlePct: n ? Math.round((full.filter(Boolean).length / n) * 100) : 0,
    longestFullThrottleM: Math.max(0, ...fullRuns.map(([a, b]) => (b - a + 1) * spacing)),
    topSpeedKph: Math.max(0, ...lap.speed),
    brakingZones: runs(lap.brake.map((b) => b > 0), MERGE_GAP_SAMPLES).length,
    corners,
  };
}

export function thinTrace(lap: LapChannels, everyM: number): LapChannels {
  const keep = lap.distanceM.map((d, i) => (i === 0 || d % everyM === 0 ? i : -1)).filter((i) => i >= 0);
  const pick = (values: number[]) => keep.map((i) => values[i]);
  return { distanceM: pick(lap.distanceM), speed: pick(lap.speed), throttle: pick(lap.throttle), brake: pick(lap.brake) };
}
