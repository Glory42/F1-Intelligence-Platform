export type RaceControlMessage = {
  id: number; raceId: number; date: string; category: string; flag: string | null;
  lapNumber: number | null; driverNumber: number | null; scope: string | null;
  sector: number | null; message: string;
};

export type RaceOvertake = {
  id: number; raceId: number; date: string;
  overtakingDriverId: number; overtakenDriverId: number; position: number;
};

export type TeamRadioClip = {
  id: number; raceId: number; driverId: number; date: string; recordingUrl: string;
};
