import type { Driver } from './drivers';

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
