import type { Circuit } from './circuits';
import type { Driver } from './drivers';
import type { Race } from './races';
import type { Team } from './teams';

export type ModelInfo = {
  gpVersion: string;
  sprintVersion: string;
};

export type FeatureScores = {
  carPerformance: string;
  driverRating: string;
  startingPosition: string;
  winRate: string;
  luckFactor: string;
  weatherImpact: string;
  trackOvertake: string | null;
  positionGain: string;
  longRunPace: string | null;
  reliability: string | null;
  qualifyingDelta: string | null;
  sectorStrength: string | null;
  tyreDeg: string | null;
  circuitAdjStartPos: string | null;
  circuitAdjPositionGain: string | null;
};

// GP and sprint predictions share one shape and differ only in their feature scores.
export type DriverPredictionOf<TFeatures> = {
  driver: Driver;
  winProbability: string;
  predictedPosition: number | null;
  features: TFeatures;
};

export type PredictionOf<TFeatures> = {
  race: Race;
  predictedWinner: Driver;
  computedAt: string;
  modelVersion: string;
  drivers: DriverPredictionOf<TFeatures>[];
};

export type DriverPrediction = DriverPredictionOf<FeatureScores>;

export type PredictionResponse = PredictionOf<FeatureScores>;

export type PredictionHistoryItem = {
  raceId: number;
  raceName: string;
  raceDate: string;
  roundNumber: number;
  circuit: Circuit;
  predictedWinner: Driver;
  actualWinner: Driver | null;
  winProbability: string;
  correct: boolean | null;
  actualWinnerPredictedPosition: number | null;
  computedAt: string;
  isSprint: boolean;
};

export type AccuracyBucket = {
  races: number;
  correct: number;
  accuracyPct: number | null;
};

export type SeasonAccuracy = {
  year: number;
  gp: AccuracyBucket;
  sprint: AccuracyBucket;
  overall: AccuracyBucket;
};

export type IntelStandingRow = {
  driver: Driver;
  features: FeatureScores;
  rawWeightedScore: string;
  winProbability: string;
  predictedPosition: number | null;
  overallScore: number;
  sprintWins: number;
  sprintPodiums: number;
  sprintTotalPoints: string;
  // The driver's GP + sprint season points (driver_season_stats), same convention as DriverSeasonStats.
  championshipPoints: string;
};

export type FridayPaceRow = {
  driver: Driver;
  compound: string;
  sessionType: string;
  medianLapMs: number;
  stintLength: number | null;
  deltaToFastestMs: number;
};

type OddsFields = { titleProbability: number; expectedPoints: number; pointsP10: number; pointsP90: number };

export type TitleOddsResponse = {
  afterRound: number;
  drivers: Array<{ driver: Driver } & OddsFields>;
  teams: Array<{ team: Team } & OddsFields>;
  history: Array<{ afterRound: number; driverId: number; titleProbability: number }>;
};
