import type { Driver } from './drivers';
import type { DriverPredictionOf, GpFeatures, PredictionOf } from './predictions';
import type { LapSummary, Race } from './races';

export type SprintResult = {
  id: number;
  raceId: number;
  driverId: number;
  finishPosition: number | null;
  gridPosition: number;
  points: string;
  status: string;
  fastestLap: boolean;
  sq1TimeMs: number | null;
  sq2TimeMs: number | null;
  sq3TimeMs: number | null;
  sqSector1Ms: number | null;
  sqSector2Ms: number | null;
  sqSector3Ms: number | null;
  sqSpeedSt: string | null;
  driver: Driver;
};

// sprint-v3 scores the sprint grid with weighted-v4's features and weights.
export type DriverSprintPrediction = DriverPredictionOf<GpFeatures>;

export type SprintPredictionResponse = PredictionOf<GpFeatures>;

export type SprintDetailResponse = {
  race: Race;
  prediction: SprintPredictionResponse | null;
  results: SprintResult[];
  laps: LapSummary[];
};
