import type { Driver } from './drivers';
import type { Team } from './teams';

export type TyreStint = {
  stintNumber: number;
  compound: string | null;
  lapStart: number | null;
  lapEnd: number | null;
  tyreAgeAtStart: number | null;
};

export type PitStop = { lapNumber: number; pitLaneMs: number | null; stationaryMs: number | null };

export type DriverStrategy = { driver: Driver; finishPosition: number | null; stints: TyreStint[]; pitStops: PitStop[] };

// 'openf1' = recorded stints (OpenF1 from 2023, FastF1 before); 'derived' = reconstructed from accurate lap_times only, so gaps
// around pit laps are expected; 'none' = no tyre data at all.
export type StrategyResponse = { source: 'openf1' | 'derived' | 'none'; drivers: DriverStrategy[] };

// Fuel-corrected time lost per lap of tyre age, pooled over a team's stints on one compound.
export type TyreDegradation = {
  team: Team;
  compound: string;
  msPerLap: number;
  laps: number;
  stints: number;
  // Time lost to a new set at each tyre age (3-lap buckets).
  points: Array<{ tyreAge: number; lossMs: number }>;
};

export type StrategyInsightsResponse = { degradation: TyreDegradation[] };
