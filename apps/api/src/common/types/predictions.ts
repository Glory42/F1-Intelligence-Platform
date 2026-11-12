import type { Circuit } from './circuits';
import type { Driver } from './drivers';
import type { Race } from './races';
import type { Team } from './teams';

export type ModelInfo = {
  gpVersion: string;
  sprintVersion: string;
};

// One feature of a driver's Prediction, for either model. value: the feature in its own units (GP) or its
// 0–1 Feature Score (sprint); contribution: its term in the driver's log-odds score, so a softmax over the
// field of the summed contributions is the win probability.
export type FeatureTerm = { value: number; contribution: number };

// weighted-v4's features as stored by data-engine's compute_features (snake_case keys, the Python names).
export type StoredGpFeatureTerm = FeatureTerm;
export type StoredGpFeatures = Record<string, FeatureTerm>;

export type GpFeatureKey =
  | 'grid'
  | 'qualiPace'
  | 'teamQualiPace'
  | 'driverPoints'
  | 'teammateEdge'
  | 'gridProcessional'
  | 'teamRacePace';

export type GpFeatures = Record<GpFeatureKey, FeatureTerm>;

// How a Prediction's page presents one feature. importance: the feature's share of the model in %
// (GP: of the fitted |weight per SD|; sprint: its hand weight).
export type FeatureInfo<TKey extends string = string> = {
  key: TKey;
  label: string;
  shortLabel: string;
  importance: number;
};

// GP and sprint predictions share one shape and differ only in which features they have.
export type DriverPredictionOf<TFeatures> = {
  driver: Driver;
  winProbability: string;
  predictedPosition: number | null;
  // P(top 3) implied by the win probabilities: GP only, null for sprints and rows written before it.
  podiumProbability: string | null;
  // From the session's qualifying (GP) or sprint qualifying (sprint) sheet.
  gridPosition: number | null;
  features: TFeatures;
};

export type PredictionOf<TFeatures> = {
  race: Race;
  predictedWinner: Driver;
  computedAt: string;
  modelVersion: string;
  // The model's features in display order.
  featureInfo: FeatureInfo<Extract<keyof TFeatures, string>>[];
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

// Every driver's GP win probability in one 10-point band (`from` to `from` + 0.1) and how many of them won.
export type CalibrationBin = {
  from: number;
  predictions: number;
  wins: number;
  probabilitySum: number;
};

// Averaged per race. Brier: Σ over the field of (p − won)², 0 is perfect. Log loss: −ln p(winner).
export type ForecastScore = {
  brier: number;
  logLoss: number;
};

export type SeasonCalibration = {
  races: number;
  // Share of every scored race won from pole: the pole baseline's chance for the pole-sitter.
  poleWinRate: number;
  bins: CalibrationBin[];
  model: ForecastScore;
  pole: ForecastScore;
  uniform: ForecastScore;
};

export type SeasonAccuracy = {
  year: number;
  gp: AccuracyBucket;
  sprint: AccuracyBucket;
  overall: AccuracyBucket;
  // GP model only; null until the season has a completed GP the model scored.
  calibration: SeasonCalibration | null;
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

type OddsFields = { titleProbability: number; expectedPoints: number; pointsP10: number; pointsP90: number };

export type TitleOddsResponse = {
  afterRound: number;
  drivers: Array<{ driver: Driver } & OddsFields>;
  teams: Array<{ team: Team } & OddsFields>;
  history: Array<{ afterRound: number; driverId: number; titleProbability: number }>;
};
