import type { Driver } from './drivers';
import type { DriverPredictionOf, PredictionOf } from './predictions';
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

export type SprintFeatureScores = {
  carPerformance: string;
  startingPosition: string;
  driverRating: string;
  trackOvertake: string | null;
  shortRunPace: string;
  weatherImpact: string;
  winRate: string;
  luckFactor: string;
  circuitAdjStartPos: string | null;
  sqQualifyingDelta: string | null;
};

export type DriverSprintPrediction = DriverPredictionOf<SprintFeatureScores>;

export type SprintPredictionResponse = PredictionOf<SprintFeatureScores>;

export type SprintDetailResponse = {
  race: Race;
  prediction: SprintPredictionResponse | null;
  results: SprintResult[];
  laps: LapSummary[];
};
