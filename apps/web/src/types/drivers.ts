import type { RaceResult } from './races';
import type { Team } from './teams';

export type Driver = {
  id: number; seasonId: number; teamId: number; driverNumber: number;
  code: string; firstName: string; lastName: string; fullName: string;
  nationality: string | null; headshotUrl: string | null; team: Team;
};

export type DriverSeasonStats = {
  racesEntered: number; racesFinished: number; wins: number; podiums: number; poles: number;
  totalPoints: string; championshipPosition: number | null; avgFinishPosition: string | null;
  winRate: string | null; avgPositionGain: string | null;
  dnfCount: number; dnfRate: string | null;
  avgSector1Ms: number | null; avgSector2Ms: number | null; avgSector3Ms: number | null;
  topSpeedAvg: string | null; teammateQualiDelta: string | null;
  // GP and sprint points are stored separately; championshipPoints is their sum.
  sprintTotalPoints: string; championshipPoints: string;
};

export type DriverDetailResponse = {
  driver: Driver; seasonStats: DriverSeasonStats;
  recentResults: (RaceResult & { race: { name: string; raceDate: string } })[];
};

export type DriverStanding = { driver: Driver; stats: DriverSeasonStats };

export type DriverYearStats = {
  year: number; driverId: number; driverNumberThatYear: number; teamName: string; headshotUrl: string | null; stats: DriverSeasonStats | null;
};

export type HeadToHead = { driver: number; teammate: number };

export type TeammateOuting = {
  qualiPosition: number | null; finishPosition: number | null; status: string | null; points: number;
};

export type TeammateRace = {
  raceId: number; roundNumber: number; raceName: string;
  /** Negative = the driver out-qualified the team-mate. */
  qualiGapMs: number | null;
  driver: TeammateOuting; teammate: TeammateOuting;
};

export type TeammateBattle = {
  teammate: Driver | null;
  sharedRaces: number;
  qualifying: HeadToHead;
  race: HeadToHead;
  points: HeadToHead;
  medianQualiGapMs: number | null;
  races: TeammateRace[];
};

export type RacecraftRow = { driver: Driver; made: number; suffered: number; net: number };
