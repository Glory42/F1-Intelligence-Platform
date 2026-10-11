import type { Driver } from './drivers';

// nationality is an F1DB country id (e.g. 'united-kingdom'); coreId links to the driver/team page
// (core data starts in 1980); active means on the current grid.
export type RecordEntry = {
  f1dbId: string; name: string; value: number; nationality: string | null; coreId: number | null; active: boolean;
};

export type DriverRecordStat = 'wins' | 'championships' | 'poles' | 'podiums' | 'starts';

export type RecordChase = { stat: DriverRecordStat; record: RecordEntry; chaser: RecordEntry | null };

export type HistoryRecords = {
  drivers: Record<DriverRecordStat, RecordEntry[]>;
  constructors: Record<'wins' | 'championships' | 'poles', RecordEntry[]>;
  // value is a 0–1 ratio over race starts; only drivers with rateMinStarts or more qualify.
  rates: Record<'winRate' | 'poleRate' | 'podiumRate', RecordEntry[]>;
  rateMinStarts: number;
  chases: RecordChase[];
};

export type MilestoneKey =
  | 'youngestWinner' | 'youngestPole' | 'youngestPodium' | 'youngestStarter' | 'oldestFirstWin' | 'longestWaitForWin';

export type MilestoneEntry = {
  f1dbId: string; name: string; nationality: string | null; coreId: number | null; active: boolean; days: number; raceName: string;
};

export type HistoryMilestones = Record<MilestoneKey, MilestoneEntry[]>;

export type LineageMember = {
  f1dbId: string; name: string; yearFrom: number; yearTo: number | null; raceWins: number; championships: number;
  coreId: number | null;
};

export type ConstructorLineage = {
  f1dbId: string; name: string; coreTeam: { id: number; teamKey: string } | null; active: boolean; members: LineageMember[];
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

export type OnThisDayRace = { raceId: number; year: number; name: string; winner: Driver | null };

// date is the month-day actually shown: the nearest one with races when requested has none.
export type OnThisDay = { requested: string; date: string; races: OnThisDayRace[] };
