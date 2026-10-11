import type {
  CircuitHistoryItem, Driver, DriverPrediction, LapSummary, QualifyingResult, RaceResult, SprintResult,
} from '@/types';
import { formatMs } from '@/lib/utils';

export type Condition = { label: string; val: string | number };

export type SessionConditions = {
  safetyCarLaps: number | null;
  vscLaps: number | null;
  airTempAvg: string | null;
  trackTempAvg: string | null;
  humidityAvg: string | null;
};

type FinishRow = Pick<RaceResult, 'driverId' | 'driver' | 'finishPosition' | 'fastestLap'>;

export function predictedPodium<T extends Pick<DriverPrediction, 'predictedPosition'>>(drivers: T[], size = 5): T[] {
  return [...drivers].sort((a, b) => (a.predictedPosition ?? 99) - (b.predictedPosition ?? 99)).slice(0, size);
}

export function winnerOf<T extends FinishRow>(results: T[]): T | null {
  return results.find((r) => r.finishPosition === 1) ?? null;
}

export function fastestLapOf(results: FinishRow[], laps: LapSummary[]): { code: string; timeStr: string | null } | null {
  const holder = results.find((r) => r.fastestLap);
  if (!holder) return null;
  const lapMs = laps.find((l) => l.driverId === holder.driver.id)?.fastestLapMs ?? null;
  return { code: holder.driver.code, timeStr: lapMs ? formatMs(lapMs) : null };
}

export function conditionsOf(c: SessionConditions): Condition[] {
  const out: Condition[] = [];
  if (c.safetyCarLaps != null) out.push({ label: 'SC Laps', val: c.safetyCarLaps });
  if (c.vscLaps != null) out.push({ label: 'VSC', val: c.vscLaps });
  if (c.airTempAvg) out.push({ label: 'Air', val: `${Math.round(Number(c.airTempAvg))}°C` });
  if (c.trackTempAvg) out.push({ label: 'Track', val: `${Math.round(Number(c.trackTempAvg))}°C` });
  if (c.humidityAvg) out.push({ label: 'Humidity', val: `${Math.round(Number(c.humidityAvg))}%` });
  return out;
}

// The year picker in the hero jumps to the same session at this circuit in other seasons.
export function circuitYearItems(history: CircuitHistoryItem[], session: 'race' | 'sprint'): Array<{ year: number; href: string }> {
  return history
    .filter((h) => session === 'race' || h.hasSprint)
    .sort((a, b) => b.year - a.year)
    .map((h) => ({ year: h.year, href: session === 'race' ? `/races/${h.raceId}` : `/races/${h.raceId}/sprint` }));
}

export function driverMapOf(results: Array<Pick<RaceResult, 'driverId' | 'driver'>>): Map<number, Driver> {
  return new Map(results.map((r) => [r.driverId, r.driver]));
}

// Sprint qualifying times live on the sprint result row; reshaped so QualifyingGrid can render them.
export function sprintQualifyingGrid(results: SprintResult[]): QualifyingResult[] {
  return [...results]
    .sort((a, b) => a.gridPosition - b.gridPosition)
    .map((r) => ({
      id: r.id,
      driverId: r.driverId,
      gridPosition: r.gridPosition,
      q1TimeMs: r.sq1TimeMs ?? null,
      q2TimeMs: r.sq2TimeMs ?? null,
      q3TimeMs: r.sq3TimeMs ?? null,
      sector1Ms: r.sqSector1Ms ?? null,
      sector2Ms: r.sqSector2Ms ?? null,
      sector3Ms: r.sqSector3Ms ?? null,
      speedSt: r.sqSpeedSt ?? null,
      driver: r.driver,
    }));
}
