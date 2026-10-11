import type { TrackProfile } from '../../modules/circuits/track-profile.helpers';
import type { Driver } from './drivers';
import type { Team } from './teams';

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

export type CircuitTelemetry = {
  raceId: number; year: number; raceName: string; driver: Driver; lapTimeMs: number; isPoleLap: boolean;
  profile: TrackProfile;
  trace: { distanceM: number[]; speed: number[]; throttle: number[]; brake: number[] };
};
