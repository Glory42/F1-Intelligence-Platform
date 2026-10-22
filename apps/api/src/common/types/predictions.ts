import type { Circuit } from './circuits';
import type { Driver } from './drivers';
import type { Race } from './races';
import type { Team } from './teams';

export type ModelInfo = {
  gpVersion: string;
  sprintVersion: string;
};

// weighted-v4's features as stored by data-engine's compute_features (snake_case keys, the Python names).
// value: the feature in its own units; contribution: its term in the driver's log-odds score.
export type StoredGpFeatureTerm = { value: number; contribution: number };
export type StoredGpFeatures = Record<string, StoredGpFeatureTerm>;

export type GpFeatureKey =
  | 'grid'
  | 'qualiPace'
  | 'teamQualiPace'
  | 'driverPoints'
  | 'teammateEdge'
  | 'gridProcessional'
  | 'teamRacePace';

// A driver's win probability is softmax over the field of the summed contributions (T = 1).
export type GpFeatures = Record<GpFeatureKey, StoredGpFeatureTerm>;

// GP and sprint predictions share one shape and differ only in their features.
export type DriverPredictionOf<TFeatures> = {
  driver: Driver;
  winProbability: string;
  predictedPosition: number | null;
  // From the session's qualifying (GP) or sprint qualifying (sprint) sheet.
  gridPosition: number | null;
  features: TFeatures;
};

export type PredictionOf<TFeatures> = {
  race: Race;
  predictedWinner: Driver;
  computedAt: string;
  modelVersion: string;
  drivers: DriverPredictionOf<TFeatures>[];
};

export type DriverPrediction = DriverPredictionOf<GpFeatures>;

export type PredictionResponse = PredictionOf<GpFeatures>;

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
