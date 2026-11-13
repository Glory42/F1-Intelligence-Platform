import { median } from '../../common/stats';

export interface DegradationLap {
  teamId: number;
  driverId: number;
  lapNumber: number;
  lapTimeMs: number | null;
  compound: string | null;
  tyreLife: number | null;
}

export interface TeamCompoundDegradation {
  teamId: number;
  compound: string;
  msPerLap: number;
  laps: number;
  stints: number;
  points: Array<{ tyreAge: number; lossMs: number }>;
}

// The common public estimate of lap time per lap of fuel on board: without taking it out, the car
// getting lighter hides most of the wear.
export const FUEL_EFFECT_MS_PER_LAP = 55;
// lap_times already holds only green-flag laps (no lap 1, in/out or SC laps); this catches traffic and mistakes.
const OUTLIER_RATIO = 1.07;
const MIN_STINT_LAPS = 5;
const MIN_TEAM_LAPS = 10;
const AGE_BUCKET = 3;
// Softest first. 2018 named seven compounds; wet-weather tyres are left out because a drying track swamps wear.
const DRY_COMPOUNDS = ['HYPERSOFT', 'ULTRASOFT', 'SUPERSOFT', 'SOFT', 'MEDIUM', 'HARD', 'SUPERHARD'];

type CleanLap = { age: number; ms: number };
type Stint = { teamId: number; compound: string; laps: CleanLap[] };

function cleanStints(laps: DegradationLap[], totalLaps: number): Stint[] {
  const byStint = new Map<string, { teamId: number; compound: string; laps: DegradationLap[] }>();
  for (const lap of laps) {
    if (lap.lapTimeMs == null || lap.tyreLife == null || lap.compound == null) continue;
    if (!DRY_COMPOUNDS.includes(lap.compound)) continue;
    // Lap number and tyre age rise together on one set, so their difference names the stint
    // (stint_number is missing for most seasons).
    const key = `${lap.driverId}:${lap.compound}:${lap.lapNumber - lap.tyreLife}`;
    const stint = byStint.get(key) ?? { teamId: lap.teamId, compound: lap.compound, laps: [] };
    stint.laps.push(lap);
    byStint.set(key, stint);
  }

  return [...byStint.values()].flatMap(({ teamId, compound, laps: raw }) => {
    const limit = median(raw.map((l) => l.lapTimeMs!))! * OUTLIER_RATIO;
    const clean = raw
      .filter((l) => l.lapTimeMs! <= limit)
      .map((l) => ({ age: l.tyreLife!, ms: l.lapTimeMs! - FUEL_EFFECT_MS_PER_LAP * (totalLaps - l.lapNumber) }));
    return clean.length >= MIN_STINT_LAPS ? [{ teamId, compound, laps: clean }] : [];
  });
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

// Least squares with an intercept per stint: each set keeps its own baseline (fuel-model error,
// track evolution, driver), and only how time grows with tyre age within a set is pooled.
function fitTeamCompound(stints: Stint[]): Omit<TeamCompoundDegradation, 'teamId' | 'compound'> | null {
  const centred = stints.map((s) => ({ s, age: mean(s.laps.map((l) => l.age)), ms: mean(s.laps.map((l) => l.ms)) }));
  let sxy = 0;
  let sxx = 0;
  for (const { s, age, ms } of centred) {
    for (const l of s.laps) {
      sxy += (l.age - age) * (l.ms - ms);
      sxx += (l.age - age) ** 2;
    }
  }
  const laps = stints.reduce((n, s) => n + s.laps.length, 0);
  if (laps < MIN_TEAM_LAPS || sxx === 0) return null;
  const slope = sxy / sxx;

  const buckets = new Map<number, Array<{ age: number; loss: number }>>();
  for (const { s, age, ms } of centred) {
    const newSetMs = ms - slope * age;
    for (const l of s.laps) {
      const bucket = Math.floor((l.age - 1) / AGE_BUCKET);
      buckets.set(bucket, [...(buckets.get(bucket) ?? []), { age: l.age, loss: l.ms - newSetMs }]);
    }
  }
  const points = [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, b]) => ({ tyreAge: Math.round(mean(b.map((p) => p.age))), lossMs: Math.round(mean(b.map((p) => p.loss))) }));

  return { msPerLap: Math.round(slope), laps, stints: stints.length, points };
}

export function teamDegradation(laps: DegradationLap[], totalLaps: number): TeamCompoundDegradation[] {
  const groups = new Map<string, Stint[]>();
  for (const stint of cleanStints(laps, totalLaps)) {
    const key = `${stint.teamId}:${stint.compound}`;
    groups.set(key, [...(groups.get(key) ?? []), stint]);
  }

  return [...groups.values()]
    .flatMap((stints) => {
      const fit = fitTeamCompound(stints);
      return fit ? [{ teamId: stints[0].teamId, compound: stints[0].compound, ...fit }] : [];
    })
    .sort((a, b) =>
      DRY_COMPOUNDS.indexOf(a.compound) - DRY_COMPOUNDS.indexOf(b.compound) || a.msPerLap - b.msPerLap);
}
