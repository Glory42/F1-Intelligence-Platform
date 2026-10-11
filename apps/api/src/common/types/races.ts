import type { Circuit } from './circuits';
import type { Driver } from './drivers';
import type { RaceBattle } from './race-story';

// Both sessions of a sprint weekend share one race_id; this picks which one a race-event row belongs to.
export type RaceSession = 'race' | 'sprint';

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

export type RaceDetailResponse = {
  race: Race;
  results: RaceResult[];
  qualifying: QualifyingResult[];
  laps: LapSummary[];
};

export type RaceRecap = {
  winner: Driver | null;
  predictedWinner: Driver | null;
  predictionHit: boolean | null;
  fastestStop: { driver: Driver; stationaryMs: number } | null;
  topBattle: RaceBattle | null;
};
