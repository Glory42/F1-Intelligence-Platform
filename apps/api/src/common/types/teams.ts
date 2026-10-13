import type { Driver } from './drivers';

export type Team = {
  id: number;
  seasonId: number;
  teamKey: string;
  name: string;
  nationality: string | null;
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
  // GP and sprint points are stored separately; championshipPoints is their sum.
  sprintTotalPoints: string;
  championshipPoints: string;
};

export type TeamDetailResponse = {
  team: Team;
  seasonStats: TeamSeasonStats;
  drivers: Driver[];
};

export type TeamStanding = {
  team: Team;
  stats: TeamSeasonStats;
};

export type TeamYearStats = {
  year: number;
  teamId: number;
  stats: TeamSeasonStats | null;
};

export type PitCrewRanking = { team: Team; stops: number; medianStationaryMs: number; fastestStationaryMs: number };

export type TeamPitStop = { raceId: number; roundNumber: number; raceName: string; driver: Driver; lapNumber: number; stationaryMs: number };
