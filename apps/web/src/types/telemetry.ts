import type { Driver } from './drivers';

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
