import type { Driver } from './drivers';
import type { DriverPredictionOf, FeatureTerm, PredictionOf } from './predictions';
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

// sprint-v2's eight weighted Feature Scores.
export type SprintFeatureKey =
  | 'carPerformance'
  | 'circuitAdjStartPos'
  | 'shortRunPace'
  | 'driverRating'
  | 'weatherImpact'
  | 'winRate'
  | 'luckFactor'
  | 'sqQualifyingDelta';

export type SprintFeatures = Record<SprintFeatureKey, FeatureTerm>;

export type DriverSprintPrediction = DriverPredictionOf<SprintFeatures>;

export type SprintPredictionResponse = PredictionOf<SprintFeatures>;

export type SprintDetailResponse = {
  race: Race;
  prediction: SprintPredictionResponse | null;
  results: SprintResult[];
  laps: LapSummary[];
};
