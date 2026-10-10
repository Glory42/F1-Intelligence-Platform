// Both sessions of a sprint weekend share one race_id; this picks which one a race-event row belongs to.
export type RaceSession = 'race' | 'sprint';

export type SeasonSummary = { year: number; raceCount: number };

export type ModelInfo = {
  gpVersion: string;
  sprintVersion: string;
};

export type Bindings = {
  DATABASE_URL: string;
  R2_PUBLIC_URL?: string;
  ENVIRONMENT?: string;
};

export type ApiSuccess<T> = { data: T; error: null };
export type ApiError = { data: null; error: { code: string; message: string } };
export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export type Circuit = {
  id: number;
  circuitKey: string;
  name: string;
  country: string;
  city: string;
  lapCount: number;
  trackLengthKm: string;
  overtakeRate: string | null;
  numberOfCorners: number | null;
  drsZones: number | null;
  scProbability: string | null;
  imageUrl: string | null;
};

export type Team = {
  id: number;
  seasonId: number;
  teamKey: string;
  name: string;
  nationality: string | null;
};

export type Driver = {
  id: number;
  seasonId: number;
  teamId: number;
  driverNumber: number;
  code: string;
  firstName: string;
  lastName: string;
  fullName: string;
  nationality: string | null;
  headshotUrl: string | null;
  team: Team;
};

export type Race = {
  id: number;
  seasonId: number;
  roundNumber: number;
  name: string;
  raceDate: string;
  raceDateUtc: string | null;
  status: 'scheduled' | 'sprint_qualifying_done' | 'sprint_done' | 'qualifying_done' | 'completed';
  eventFormat: string;
  qualifyingDate: string | null;
  sprintDate: string | null;
  sprintQualifyingDate: string | null;
  hasSprint: boolean;
  weather: string | null;
  safetyCarLaps: number | null;
  vscLaps: number | null;
  airTempAvg: string | null;
  trackTempAvg: string | null;
  humidityAvg: string | null;
  sprintWeather: string | null;
  sprintSafetyCarLaps: number | null;
  sprintVscLaps: number | null;
  sprintAirTempAvg: string | null;
  sprintTrackTempAvg: string | null;
  sprintHumidityAvg: string | null;
  circuit: Circuit;
};

export type RaceResult = {
  id: number;
  raceId: number;
  driverId: number;
  finishPosition: number | null;
  gridPosition: number;
  points: string;
  status: string;
  fastestLap: boolean;
  driver: Driver;
};

export type QualifyingResult = {
  id: number;
  driverId: number;
  gridPosition: number;
  q1TimeMs: number | null;
  q2TimeMs: number | null;
  q3TimeMs: number | null;
  sector1Ms: number | null;
  sector2Ms: number | null;
  sector3Ms: number | null;
  speedSt: string | null;
  driver: Driver;
};

export type LapSummary = {
  driverId: number;
  fastestLapMs: number | null;
  avgLapMs: number | null;
  totalLaps: number;
  driver: Driver;
};

export type DriverSeasonStats = {
  racesEntered: number;
  racesFinished: number;
  wins: number;
  podiums: number;
  poles: number;
  totalPoints: string;
  championshipPosition: number | null;
  avgFinishPosition: string | null;
  winRate: string | null;
  avgPositionGain: string | null;
  dnfCount: number;
  dnfRate: string | null;
  avgSector1Ms: number | null;
  avgSector2Ms: number | null;
  avgSector3Ms: number | null;
  topSpeedAvg: string | null;
  teammateQualiDelta: string | null;
  // GP and sprint points are stored separately; the championship total is their sum.
  sprintTotalPoints: string;
};

export type TeamSeasonStats = {
  racesCompleted: number;
  wins: number;
  podiums: number;
  totalPoints: string;
  championshipPosition: number | null;
  avgFinishPosition: string | null;
  carPerformanceScore: string | null;
  dnfCount: number;
  reliabilityScore: string | null;
  // GP and sprint points are stored separately; the championship total is their sum.
  sprintTotalPoints: string;
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

export type DriverPrediction = {
  driver: Driver;
  winProbability: string;
  predictedPosition: number | null;
  features: FeatureScores;
};

export type PredictionResponse = {
  race: Race;
  predictedWinner: Driver;
  computedAt: string;
  modelVersion: string;
  drivers: DriverPrediction[];
};

export type RaceDetailResponse = {
  race: Race;
  results: RaceResult[];
  qualifying: QualifyingResult[];
  laps: LapSummary[];
};

export type RaceControlMessage = {
  id: number;
  raceId: number;
  date: string;
  category: string;
  flag: string | null;
  lapNumber: number | null;
  driverNumber: number | null;
  scope: string | null;
  sector: number | null;
  message: string;
};

export type RaceOvertake = {
  id: number;
  raceId: number;
  date: string;
  overtakingDriverId: number;
  overtakenDriverId: number;
  position: number;
};

export type TeamRadioClip = {
  id: number;
  raceId: number;
  driverId: number;
  date: string;
  recordingUrl: string;
};

export type DriverDetailResponse = {
  driver: Driver;
  seasonStats: DriverSeasonStats;
  recentResults: (RaceResult & { race: { name: string; raceDate: string } })[];
};

export type TeamDetailResponse = {
  team: Team;
  seasonStats: TeamSeasonStats;
  drivers: Driver[];
};

export type DriverStanding = {
  driver: Driver;
  stats: DriverSeasonStats;
};

export type TeamStanding = {
  team: Team;
  stats: TeamSeasonStats;
};

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
};

export type CircuitHistoryItem = {
  raceId: number;
  raceName: string;
  raceDate: string;
  year: number;
  hasSprint: boolean;
  winner: Driver | null;
};

export type CircuitDetailResponse = {
  circuit: Circuit;
  history: CircuitHistoryItem[];
  // SVG path in a 1000×1000 viewBox drawn from the latest stored pole lap; null before 2023 data.
  outlinePath: string | null;
  fastestLap: {
    timeMs: number;
    driver: Driver;
    year: number;
  } | null;
  dominance: {
    all: {
      constructors: { team: Team; wins: number }[];
      drivers: { driver: Driver; wins: number }[];
    };
    modern: {
      constructors: { team: Team; wins: number }[];
      drivers: { driver: Driver; wins: number }[];
    };
    legacy: {
      constructors: { team: Team; wins: number }[];
      drivers: { driver: Driver; wins: number }[];
    };
    nineties: {
      constructors: { team: Team; wins: number }[];
      drivers: { driver: Driver; wins: number }[];
    };
  };
  weatherStats: {
    dry: number;
    wet: number;
    mixed: number;
    unknown: number;
  };
  qualifyingImpact: {
    poleToWinRate: number;
    avgWinnerGridPos: number;
  };
  safetyCarStats: {
    avgScLaps: number;
    scRaceRate: number;
  };
};

export type DriverYearStats = {
  year: number;
  driverId: number;
  driverNumberThatYear: number;
  teamName: string;
  headshotUrl: string | null;
  stats: DriverSeasonStats | null;
};

export type TeamYearStats = {
  year: number;
  teamId: number;
  stats: TeamSeasonStats | null;
};

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

export type DriverSprintPrediction = {
  driver: Driver;
  winProbability: string;
  predictedPosition: number | null;
  features: SprintFeatureScores;
};

export type SprintPredictionResponse = {
  race: Race;
  predictedWinner: Driver;
  computedAt: string;
  modelVersion: string;
  drivers: DriverSprintPrediction[];
};

export type SprintDetailResponse = {
  race: Race;
  prediction: SprintPredictionResponse | null;
  results: SprintResult[];
  laps: LapSummary[];
};

export type QualitySeverity = 'high' | 'medium' | 'low';

export type QualityIssue = {
  raceId: number | null;
  roundNumber: number | null;
  year: number;
  tableName: string | null;
  checkName: string;
  severity: QualitySeverity;
  detail: string | null;
  fixable: boolean;
  isSprint: boolean;
};

export type QualityReport = {
  year: number;
  generatedAt: string;
  healthScore: string;
  racesAudited: number;
  issueCount: number;
  fixableCount: number;
  bySeverity: Record<QualitySeverity, number>;
  byTable: Record<string, number>;
  issues: QualityIssue[];
};

export type TyreStint = {
  stintNumber: number;
  compound: string | null;
  lapStart: number | null;
  lapEnd: number | null;
  tyreAgeAtStart: number | null;
};

export type PitStop = { lapNumber: number; pitLaneMs: number | null; stationaryMs: number | null };

export type DriverStrategy = { driver: Driver; finishPosition: number | null; stints: TyreStint[]; pitStops: PitStop[] };

// 'openf1' = real stint data (2023+); 'derived' = reconstructed from accurate lap_times only, so gaps
// around pit laps are expected; 'none' = no tyre data at all.
export type StrategyResponse = { source: 'openf1' | 'derived' | 'none'; drivers: DriverStrategy[] };

export type PitCrewRanking = { team: Team; stops: number; medianStationaryMs: number; fastestStationaryMs: number };

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

export type HeadToHead = { driver: number; teammate: number };

export type TeammateBattle = {
  teammate: Driver | null;
  sharedRaces: number;
  qualifying: HeadToHead;
  race: HeadToHead;
  points: HeadToHead;
};

export type RacecraftRow = { driver: Driver; made: number; suffered: number; net: number };

export type DriverLapTrace = {
  driver: Driver;
  finishPosition: number | null;
  positions: number[];
  gapsMs: Array<number | null>;
  intervalsMs: Array<number | null>;
  lapsDown: number[];
};

export type RaceBattle = { chaser: Driver; leader: Driver; lapStart: number; lapEnd: number; minGapMs: number };

export type SessionWeather = { minuteOffsets: number[]; airTempC: number[]; trackTempC: number[]; rainfall: boolean[] };

export type RaceStoryResponse = { drivers: DriverLapTrace[]; battles: RaceBattle[]; weather: SessionWeather | null };

export type LapTelemetrySamples = {
  distanceM: number[];
  timeMs: number[];
  speed: number[];
  throttle: number[];
  brake: number[];
  gear: number[];
  x: number[];
  y: number[];
};

export type QualifyingSession = 'Q' | 'SQ';

export type TelemetryResponse = {
  session: QualifyingSession;
  drivers: Array<{ driver: Driver; lapTimeMs: number }>;
  laps: Array<{ driver: Driver; lapNumber: number; lapTimeMs: number; samples: LapTelemetrySamples }>;
};

export type RecordEntry = { f1dbId: string; name: string; value: number };

export type HistoryRecords = {
  drivers: Record<'wins' | 'championships' | 'poles' | 'podiums' | 'starts', RecordEntry[]>;
  constructors: Record<'wins' | 'championships' | 'poles', RecordEntry[]>;
  youngestWinners: Array<{ f1dbId: string; name: string; ageDays: number; raceName: string }>;
};

export type DriverHistory = {
  f1dbId: string; name: string; dateOfBirth: string | null; nationality: string | null;
  championships: number; raceStarts: number; raceWins: number; podiums: number; polePositions: number;
  fastestLaps: number; careerPoints: number; sprintWins: number; grandSlams: number;
  firstRaceDate: string | null; firstRaceName: string | null; firstWinDate: string | null; firstWinName: string | null;
  firstPodiumDate: string | null; firstPodiumName: string | null; firstPoleDate: string | null; firstPoleName: string | null;
};

export type TeamHistory = {
  constructor: { f1dbId: string; name: string; championships: number; raceStarts: number; raceWins: number;
    podiums: number; polePositions: number };
  seasons: Array<{ year: number; chassis: string | null; engine: string | null }>;
};

export type RaceRecap = {
  winner: Driver | null;
  predictedWinner: Driver | null;
  predictionHit: boolean | null;
  fastestStop: { driver: Driver; stationaryMs: number } | null;
  topBattle: RaceBattle | null;
};

export type OnThisDayRace = { raceId: number; year: number; name: string; winner: Driver | null };
