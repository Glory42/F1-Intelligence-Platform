import type {
  Circuit, Team, Driver, Race, RaceResult, QualifyingResult, LapSummary,
  FeatureScores, DriverPrediction, PredictionResponse, RaceDetailResponse,
  PredictionHistoryItem, IntelStandingRow, SeasonSummary, ModelInfo, CircuitDetailResponse,
  DriverSeasonStats, DriverYearStats, DriverDetailResponse, TeamSeasonStats, TeamYearStats,
  TeamDetailResponse, DriverStanding,
  SprintFeatureScores, DriverSprintPrediction, SprintPredictionResponse,
  SprintResult, SprintDetailResponse, RaceControlMessage, RaceOvertake, TeamRadioClip,
  StrategyResponse, FridayPaceRow, PitCrewRanking, TeamStanding, TitleOddsResponse,
  RacecraftRow, TeammateBattle, RaceStoryResponse, TelemetryResponse, LapTelemetrySamples,
  HistoryRecords, DriverHistory, TeamHistory, RaceRecap,
} from '../../web/src/types';

export const circuit: Circuit = {
  id: 5, circuitKey: 'monza', name: 'Autodromo Nazionale Monza', country: 'Italy', city: 'Monza',
  lapCount: 53, trackLengthKm: '5.793', overtakeRate: '0.850',
  numberOfCorners: 11, drsZones: 2, scProbability: '0.300', imageUrl: null,
};

export const team: Team = {
  id: 1, seasonId: 2025, teamKey: 'red-bull', name: 'Red Bull Racing', nationality: 'Austrian',
};

export const teamB: Team = {
  id: 2, seasonId: 2025, teamKey: 'ferrari', name: 'Ferrari', nationality: 'Italian',
};

export const driver: Driver = {
  id: 10, seasonId: 2025, teamId: 1, driverNumber: 1, code: 'VER',
  firstName: 'Max', lastName: 'Verstappen', fullName: 'Max Verstappen',
  nationality: 'Dutch', headshotUrl: null, team,
};

export const driverB: Driver = {
  id: 11, seasonId: 2025, teamId: 2, driverNumber: 16, code: 'LEC',
  firstName: 'Charles', lastName: 'Leclerc', fullName: 'Charles Leclerc',
  nationality: 'Monegasque', headshotUrl: null, team: teamB,
};

export const race: Race = {
  id: 1, seasonId: 2025, roundNumber: 16, name: 'Italian Grand Prix',
  raceDate: '2025-09-07', raceDateUtc: '2025-09-07T13:00:00.000Z',
  status: 'completed', eventFormat: 'conventional',
  qualifyingDate: '2025-09-06T14:00:00.000Z', sprintDate: null, sprintQualifyingDate: null,
  hasSprint: false, weather: 'dry',
  safetyCarLaps: 0, vscLaps: 0, airTempAvg: '24.5', trackTempAvg: '38.2', humidityAvg: '45.0',
  sprintWeather: null, sprintSafetyCarLaps: null, sprintVscLaps: null,
  sprintAirTempAvg: null, sprintTrackTempAvg: null, sprintHumidityAvg: null,
  circuit,
};

const featureScores: FeatureScores = {
  carPerformance: '0.80000', driverRating: '0.75000', startingPosition: '0.90000', winRate: '0.70000',
  luckFactor: '0.50000', weatherImpact: '0.50000', trackOvertake: null, positionGain: '0.55000',
  longRunPace: '0.65000', reliability: '0.85000',
  qualifyingDelta: '0.60000', sectorStrength: '0.70000',
  tyreDeg: '0.60000', circuitAdjStartPos: '0.72000', circuitAdjPositionGain: '0.40000',
};

const driverPredictions: DriverPrediction[] = [
  { driver, winProbability: '0.62000', predictedPosition: 1, features: featureScores },
  { driver: driverB, winProbability: '0.38000', predictedPosition: 2, features: featureScores },
];

export const predictionResponse: PredictionResponse = {
  race, predictedWinner: driver, computedAt: '2025-09-07T12:00:00.000Z',
  modelVersion: 'weighted-v3', drivers: driverPredictions,
};

const raceResults: RaceResult[] = [
  { id: 1, raceId: 1, driverId: 10, finishPosition: 1, gridPosition: 1, points: '25', status: 'Finished', fastestLap: true, driver },
  { id: 2, raceId: 1, driverId: 11, finishPosition: 2, gridPosition: 2, points: '18', status: 'Finished', fastestLap: false, driver: driverB },
];

const qualifyingResults: QualifyingResult[] = [
  { id: 1, driverId: 10, gridPosition: 1, q1TimeMs: 80000, q2TimeMs: 79500, q3TimeMs: 79000, sector1Ms: 25000, sector2Ms: 27000, sector3Ms: 27000, speedSt: '345.2', driver },
  { id: 2, driverId: 11, gridPosition: 2, q1TimeMs: 80200, q2TimeMs: 79700, q3TimeMs: 79200, sector1Ms: 25100, sector2Ms: 27050, sector3Ms: 27050, speedSt: '344.1', driver: driverB },
];

const laps: LapSummary[] = [
  { driverId: 10, fastestLapMs: 82500, avgLapMs: 84000, totalLaps: 53, driver },
  { driverId: 11, fastestLapMs: 82700, avgLapMs: 84200, totalLaps: 53, driver: driverB },
];

export const raceDetailResponse: RaceDetailResponse = {
  race, results: raceResults, qualifying: qualifyingResults, laps,
};

export const raceControlMessages: RaceControlMessage[] = [
  {
    id: 1, raceId: 1, date: '2025-09-07T13:00:01.000Z', category: 'SafetyCar',
    flag: null, lapNumber: 1, driverNumber: null, scope: null, sector: null,
    message: 'SAFETY CAR DEPLOYED',
  },
  {
    id: 2, raceId: 1, date: '2025-09-07T13:12:30.000Z', category: 'Flag',
    flag: 'YELLOW', lapNumber: 5, driverNumber: 16, scope: 'Sector', sector: 4,
    message: 'YELLOW IN TRACK SECTOR 4',
  },
];

export const raceOvertakes: RaceOvertake[] = [
  { id: 1, raceId: 1, date: '2025-09-07T13:20:07.000Z', overtakingDriverId: 10, overtakenDriverId: 11, position: 2 },
];

export const teamRadioClips: TeamRadioClip[] = [
  { id: 1, raceId: 1, driverId: 10, date: '2025-09-07T13:45:52.000Z', recordingUrl: 'https://example.com/clip-ver.mp3' },
];

export const predictionHistory: PredictionHistoryItem[] = [
  {
    raceId: 1, raceName: 'Italian Grand Prix', raceDate: '2025-09-07', roundNumber: 16, circuit,
    predictedWinner: driver, actualWinner: driver, winProbability: '0.62000',
    correct: true, computedAt: '2025-09-07T12:00:00.000Z', isSprint: false,
    actualWinnerPredictedPosition: 1,
  },
];

export const intelStandings: IntelStandingRow[] = [
  {
    driver, features: featureScores, rawWeightedScore: '0.680000',
    winProbability: '0.62000', predictedPosition: 1, overallScore: 0.68,
    sprintWins: 0, sprintPodiums: 0, sprintTotalPoints: '0',
  },
  {
    driver: driverB, features: featureScores, rawWeightedScore: '0.520000',
    winProbability: '0.38000', predictedPosition: 2, overallScore: 0.52,
    sprintWins: 0, sprintPodiums: 0, sprintTotalPoints: '0',
  },
];

export const seasons: SeasonSummary[] = [
  { year: 2025, raceCount: 16 },
  { year: 2024, raceCount: 24 },
];

export const modelInfo: ModelInfo = { gpVersion: 'weighted-v3', sprintVersion: 'sprint-v2' };

const driverSeasonStats: DriverSeasonStats = {
  racesEntered: 16, racesFinished: 15, wins: 8, podiums: 12, poles: 6,
  totalPoints: '350', championshipPosition: 1, avgFinishPosition: '2.1',
  winRate: '0.500', avgPositionGain: '1.2', dnfCount: 1, dnfRate: '0.06',
  avgSector1Ms: null, avgSector2Ms: null, avgSector3Ms: null, topSpeedAvg: null, teammateQualiDelta: null, sprintTotalPoints: '0',
};

const driverBSeasonStats: DriverSeasonStats = {
  ...driverSeasonStats, wins: 3, podiums: 9, poles: 2, totalPoints: '210', championshipPosition: 2,
};

export const driverCareer: DriverYearStats[] = [
  { year: 2026, driverId: 10, driverNumberThatYear: 1, teamName: 'Red Bull Racing', headshotUrl: null, stats: driverSeasonStats },
];

export const driverBCareer: DriverYearStats[] = [
  { year: 2026, driverId: 11, driverNumberThatYear: 16, teamName: 'Ferrari', headshotUrl: null, stats: driverBSeasonStats },
];

export const driverDetailResponse: DriverDetailResponse = {
  driver,
  seasonStats: driverSeasonStats,
  recentResults: [
    { ...raceResults[0], race: { name: 'Italian Grand Prix', raceDate: '2025-09-07' } },
  ],
};

export const driverBDetailResponse: DriverDetailResponse = {
  driver: driverB,
  seasonStats: driverBSeasonStats,
  recentResults: [
    { ...raceResults[1], race: { name: 'Italian Grand Prix', raceDate: '2025-09-07' } },
  ],
};

const teamSeasonStats: TeamSeasonStats = {
  racesCompleted: 16, wins: 8, podiums: 15, totalPoints: '600',
  championshipPosition: 1, avgFinishPosition: '3.5', carPerformanceScore: '0.85',
  dnfCount: 2, reliabilityScore: '0.90', sprintTotalPoints: '0',
};

export const teamCareer: TeamYearStats[] = [
  { year: 2026, teamId: 1, stats: teamSeasonStats },
];

export const teamDetailResponse: TeamDetailResponse = {
  team, seasonStats: teamSeasonStats, drivers: [driver],
};

const teamBSeasonStats: TeamSeasonStats = {
  ...teamSeasonStats, wins: 4, podiums: 10, totalPoints: '410', championshipPosition: 2,
  avgFinishPosition: '4.8', carPerformanceScore: '0.78', reliabilityScore: '0.86',
};

export const teamBCareer: TeamYearStats[] = [
  { year: 2026, teamId: 2, stats: teamBSeasonStats },
];

export const teamBDetailResponse: TeamDetailResponse = {
  team: teamB, seasonStats: teamBSeasonStats, drivers: [driverB],
};

export const teamsListResponse: Team[] = [team, teamB];

export const driverStandingsResponse: DriverStanding[] = [
  { driver, stats: driverSeasonStats },
  { driver: driverB, stats: driverBSeasonStats },
];

export const driversListResponse: Driver[] = [driver, driverB];

export const globalSearchResponse = { drivers: [driver, driverB], teams: [team, teamB], circuits: [circuit] };

export const circuitDetailResponse: CircuitDetailResponse = {
  outlinePath: 'M0,750L1000,750L1000,250L0,250Z',
  circuit,
  history: [
    { raceId: 1, raceName: 'Italian Grand Prix', raceDate: '2025-09-07', year: 2025, hasSprint: false, winner: driver },
  ],
  fastestLap: { timeMs: 80800, driver, year: 2024 },
  dominance: {
    all: { constructors: [{ team, wins: 5 }], drivers: [{ driver, wins: 5 }] },
    modern: { constructors: [{ team, wins: 3 }], drivers: [{ driver, wins: 3 }] },
    legacy: { constructors: [], drivers: [] },
    nineties: { constructors: [], drivers: [] },
  },
  weatherStats: { dry: 8, wet: 1, mixed: 0, unknown: 0 },
  qualifyingImpact: { poleToWinRate: 0.5, avgWinnerGridPos: 1.8 },
  safetyCarStats: { avgScLaps: 2.1, scRaceRate: 0.4 },
};

export const sprintRace: Race = {
  ...race, id: 2, roundNumber: 17, name: 'São Paulo Grand Prix',
  raceDate: '2025-11-09', raceDateUtc: '2025-11-09T17:00:00.000Z',
  status: 'sprint_done', eventFormat: 'sprint', hasSprint: true,
  sprintDate: '2025-11-08T14:00:00.000Z', sprintQualifyingDate: '2025-11-07T18:00:00.000Z',
  sprintWeather: 'dry', sprintSafetyCarLaps: 1, sprintVscLaps: 0,
  sprintAirTempAvg: '22.0', sprintTrackTempAvg: '35.0', sprintHumidityAvg: '55.0',
};

const sprintFeatureScores: SprintFeatureScores = {
  carPerformance: '0.82000', startingPosition: '0.88000', driverRating: '0.76000',
  trackOvertake: '0.45000', shortRunPace: '0.70000', weatherImpact: '0.50000',
  winRate: '0.66000', luckFactor: '0.52000',
  circuitAdjStartPos: '0.74000', sqQualifyingDelta: '0.61000',
};

const sprintDriverPredictions: DriverSprintPrediction[] = [
  { driver, winProbability: '0.58000', predictedPosition: 1, features: sprintFeatureScores },
  { driver: driverB, winProbability: '0.42000', predictedPosition: 2, features: sprintFeatureScores },
];

export const sprintPredictionResponse: SprintPredictionResponse = {
  race: sprintRace, predictedWinner: driver, computedAt: '2025-11-07T20:00:00.000Z',
  modelVersion: 'sprint-v2', drivers: sprintDriverPredictions,
};

const sprintResults: SprintResult[] = [
  {
    id: 1, raceId: 2, driverId: 10, finishPosition: 1, gridPosition: 1, points: '8',
    status: 'Finished', fastestLap: true,
    sq1TimeMs: 70200, sq2TimeMs: 69800, sq3TimeMs: 69500,
    sqSector1Ms: 23000, sqSector2Ms: 23200, sqSector3Ms: 23300, sqSpeedSt: '320.5', driver,
  },
  {
    id: 2, raceId: 2, driverId: 11, finishPosition: 2, gridPosition: 2, points: '7',
    status: 'Finished', fastestLap: false,
    sq1TimeMs: 70400, sq2TimeMs: 70000, sq3TimeMs: 69700,
    sqSector1Ms: 23100, sqSector2Ms: 23300, sqSector3Ms: 23300, sqSpeedSt: '319.0', driver: driverB,
  },
];

export const sprintDetailResponse: SprintDetailResponse = {
  race: sprintRace,
  prediction: sprintPredictionResponse,
  results: sprintResults,
  laps: [],
};

export const sprintWeekendRaceDetailResponse: RaceDetailResponse = {
  race: { ...sprintRace, status: 'completed' },
  results: raceResults.map((r) => ({ ...r, raceId: 2 })),
  qualifying: qualifyingResults.map((q) => ({ ...q, raceId: 2 })),
  laps: [],
};

export const sprintRaceControlMessages: RaceControlMessage[] = [
  {
    id: 3, raceId: 2, date: '2025-11-08T14:03:00.000Z', category: 'Flag',
    flag: 'DOUBLE YELLOW', lapNumber: 2, driverNumber: null, scope: 'Sector', sector: 1,
    message: 'DOUBLE YELLOW IN TRACK SECTOR 1',
  },
];

export const raceStrategyResponse: StrategyResponse = {
  source: 'openf1',
  drivers: [
    {
      driver, finishPosition: 1,
      stints: [
        { stintNumber: 1, compound: 'MEDIUM', lapStart: 1, lapEnd: 20, tyreAgeAtStart: 0 },
        { stintNumber: 2, compound: 'HARD', lapStart: 21, lapEnd: 53, tyreAgeAtStart: 0 },
      ],
      pitStops: [{ lapNumber: 20, pitLaneMs: 22340, stationaryMs: 2300 }],
    },
    {
      driver: driverB, finishPosition: 2,
      stints: [{ stintNumber: 1, compound: 'HARD', lapStart: 1, lapEnd: 53, tyreAgeAtStart: 3 }],
      pitStops: [],
    },
  ],
};

export const fridayPaceRows: FridayPaceRow[] = [
  { driver: driverB, compound: 'MEDIUM', sessionType: 'FP2', medianLapMs: 84120, stintLength: 9, deltaToFastestMs: 0 },
  { driver, compound: 'HARD', sessionType: 'FP2', medianLapMs: 84350, stintLength: 11, deltaToFastestMs: 230 },
];

export const pitCrewRankings: PitCrewRanking[] = [
  { team: teamB, stops: 41, medianStationaryMs: 2310, fastestStationaryMs: 1980 },
  { team, stops: 38, medianStationaryMs: 2450, fastestStationaryMs: 2040 },
];

export const teamStandingsResponse: TeamStanding[] = [{ team, stats: teamSeasonStats }];

export const race2026DetailResponse: RaceDetailResponse = {
  race: { ...race, id: 3, roundNumber: 3, name: 'Japanese Grand Prix', raceDate: '2026-03-29', raceDateUtc: '2026-03-29T05:00:00.000Z' },
  // LEC qualified 2nd but took a 10-place grid drop.
  results: raceResults.map((r) => ({ ...r, raceId: 3, gridPosition: r.driverId === 11 ? 12 : r.gridPosition })),
  qualifying: qualifyingResults,
  laps: [],
};

// 2026 with five grands prix left: VER 350 vs LEC 210 — a 140-point gap LEC can no longer close.
export const races2026: Race[] = [
  { ...race, id: 30, roundNumber: 19, status: 'completed' },
  ...[20, 21, 22, 23, 24].map((round) => ({ ...race, id: 10 + round, roundNumber: round, status: 'scheduled' as const })),
];

export const titleOddsResponse: TitleOddsResponse = {
  afterRound: 19,
  drivers: [
    { driver, titleProbability: 1, expectedPoints: 452.3, pointsP10: 420, pointsP90: 475 },
    { driver: driverB, titleProbability: 0, expectedPoints: 268.1, pointsP10: 240, pointsP90: 300 },
  ],
  teams: [
    { team, titleProbability: 0.81, expectedPoints: 690, pointsP10: 650, pointsP90: 720 },
    { team: teamB, titleProbability: 0.19, expectedPoints: 640, pointsP10: 600, pointsP90: 680 },
  ],
  history: [
    { afterRound: 18, driverId: 10, titleProbability: 0.93 },
    { afterRound: 18, driverId: 11, titleProbability: 0.07 },
    { afterRound: 19, driverId: 10, titleProbability: 1 },
    { afterRound: 19, driverId: 11, titleProbability: 0 },
  ],
};

export const racecraftRows: RacecraftRow[] = [
  { driver: driverB, made: 41, suffered: 22, net: 19 },
  { driver, made: 30, suffered: 18, net: 12 },
];

export const teammateBattle: TeammateBattle = {
  teammate: { ...driverB, fullName: 'Yuki Tsunoda', code: 'TSU' },
  sharedRaces: 16,
  qualifying: { driver: 14, teammate: 2 },
  race: { driver: 12, teammate: 1 },
  points: { driver: 350, teammate: 48 },
};

export const raceStoryResponse: RaceStoryResponse = {
  drivers: [
    { driver, finishPosition: 1, positions: [2, 1, 1, 1], gapsMs: [800, 0, 0, 0], intervalsMs: [800, null, null, null], lapsDown: [0, 0, 0, 0] },
    { driver: driverB, finishPosition: 2, positions: [1, 2, 2, 2], gapsMs: [0, 600, 900, 1400], intervalsMs: [null, 600, 900, 1400], lapsDown: [0, 0, 0, 0] },
  ],
  battles: [{ chaser: driverB, leader: driver, lapStart: 2, lapEnd: 4, minGapMs: 600 }],
  weather: {
    minuteOffsets: [0, 1, 2, 3, 4],
    airTempC: [24, 24, 23.5, 23, 23],
    trackTempC: [38, 37.2, 34, 31.5, 30],
    rainfall: [false, false, true, true, false],
  },
};

// 26 points = 25 mini-sectors. VER alternates 1.00 s / 1.10 s per segment against LEC's steady
// 1.05 s, so VER takes the 13 even-numbered segments.
function fixtureLap(segmentMs: (k: number) => number, topSpeed: number): LapTelemetrySamples {
  const points = Array.from({ length: 26 }, (_, i) => i);
  const timeMs = points.map((i) => Array.from({ length: i }, (_, k) => segmentMs(k)).reduce((a, b) => a + b, 0));
  return {
    distanceM: points.map((i) => i * 200), timeMs,
    speed: points.map((i) => topSpeed - (i % 5) * 40), throttle: points.map((i) => (i % 5 === 4 ? 0 : 100)),
    brake: points.map((i) => (i % 5 === 4 ? 100 : 0)), gear: points.map(() => 7),
    x: points.map((i) => Math.round(1000 * Math.cos((2 * Math.PI * i) / 25))),
    y: points.map((i) => Math.round(600 * Math.sin((2 * Math.PI * i) / 25))),
  };
}

export const telemetryResponse: TelemetryResponse = {
  session: 'Q',
  drivers: [{ driver, lapTimeMs: 26_250 }, { driver: driverB, lapTimeMs: 26_250 }],
  laps: [
    { driver, lapNumber: 12, lapTimeMs: 26_250, samples: fixtureLap((k) => (k % 2 === 0 ? 1_000 : 1_100), 330) },
    { driver: driverB, lapNumber: 14, lapTimeMs: 26_250, samples: fixtureLap(() => 1_050, 325) },
  ],
};

const leader = (f1dbId: string, name: string, value: number) => ({ f1dbId, name, value });
export const historyRecords: HistoryRecords = {
  drivers: {
    wins: [leader('lewis-hamilton', 'Lewis Hamilton', 106), leader('michael-schumacher', 'Michael Schumacher', 91)],
    championships: [leader('lewis-hamilton', 'Lewis Hamilton', 7), leader('michael-schumacher', 'Michael Schumacher', 7)],
    poles: [leader('lewis-hamilton', 'Lewis Hamilton', 104)],
    podiums: [leader('lewis-hamilton', 'Lewis Hamilton', 202)],
    starts: [leader('fernando-alonso', 'Fernando Alonso', 425)],
  },
  constructors: {
    wins: [leader('ferrari', 'Ferrari', 250)],
    championships: [leader('ferrari', 'Ferrari', 16)],
    poles: [leader('ferrari', 'Ferrari', 254)],
  },
  youngestWinners: [{ f1dbId: 'max-verstappen', name: 'Max Verstappen', ageDays: 6802, raceName: 'Formula 1 Gran Premio de España Pirelli 2016' }],
};

export const driverHistory: DriverHistory = {
  f1dbId: 'max-verstappen', name: 'Max Verstappen', dateOfBirth: '1997-09-30', nationality: 'netherlands',
  championships: 4, raceStarts: 249, raceWins: 72, podiums: 135, polePositions: 49, fastestLaps: 38,
  careerPoints: 3632.5, sprintWins: 13, grandSlams: 6,
  firstRaceDate: '2015-03-15', firstRaceName: '2015 Formula 1 Rolex Australian Grand Prix',
  firstWinDate: '2016-05-15', firstWinName: 'Formula 1 Gran Premio de España Pirelli 2016',
  firstPodiumDate: '2016-05-15', firstPodiumName: 'Formula 1 Gran Premio de España Pirelli 2016',
  firstPoleDate: '2019-08-04', firstPoleName: 'Formula 1 Rolex Magyar Nagydíj 2019',
};

export const teamHistory: TeamHistory = {
  constructor: { f1dbId: 'red-bull', name: 'Red Bull', championships: 6, raceStarts: 400, raceWins: 130, podiums: 290, polePositions: 110 },
  seasons: [{ year: 2026, chassis: 'RB22', engine: 'Red Bull Ford' }, { year: 2025, chassis: 'RB21', engine: 'Honda RBPT' }],
};

export const lastRaceRecap: RaceRecap = {
  winner: driverB,
  predictedWinner: driver,
  predictionHit: false,
  fastestStop: { driver: driverB, stationaryMs: 1_980 },
  topBattle: { chaser: driver, leader: driverB, lapStart: 41, lapEnd: 53, minGapMs: 280 },
};
