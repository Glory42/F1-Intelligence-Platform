import type { Driver } from './drivers';

export type TyreStint = {
  stintNumber: number;
  compound: string | null;
  lapStart: number | null;
  lapEnd: number | null;
  tyreAgeAtStart: number | null;
};

export type PitStop = { lapNumber: number; pitLaneMs: number | null; stationaryMs: number | null };

export type DriverStrategy = { driver: Driver; finishPosition: number | null; stints: TyreStint[]; pitStops: PitStop[] };

export type StrategyResponse = { source: 'openf1' | 'derived' | 'none'; drivers: DriverStrategy[] };
