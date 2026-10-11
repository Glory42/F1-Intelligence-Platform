import type { drivers, teams, lapTimes, raceResults, races } from '../../db/schema';
import type { CircuitHistoryItem, CircuitDetailResponse, Driver } from '../../common/types';
import { SPRINT_FORMATS } from '../../common/constants';
import { toDriver } from '../../common/mappers';
import type { DriverWinEntry } from './circuit-era.helpers';
import { driverKeyFor } from './circuit-era.helpers';

type RaceRow = typeof races.$inferSelect;
type TeamRow = typeof teams.$inferSelect;
type DriverRow = typeof drivers.$inferSelect;
type RaceResultRow = typeof raceResults.$inferSelect;
type LapTimeRow = typeof lapTimes.$inferSelect;

export interface WinnerRow {
  race_results: RaceResultRow;
  drivers: DriverRow;
  teams: TeamRow;
}

export interface FastestLapRow {
  lap_times: LapTimeRow;
  drivers: DriverRow;
  teams: TeamRow;
  races: RaceRow;
}

export function buildCircuitHistory(
  raceRows: RaceRow[],
  winnerMap: Map<number, WinnerRow>,
  driverWinsAllEra: Map<string, DriverWinEntry>,
  limit: number
): CircuitHistoryItem[] {
  return raceRows.slice(0, limit).map((race) => {
    const winnerRow = winnerMap.get(race.id);
    let winner: Driver | null = null;

    if (winnerRow) {
      const driverKey = driverKeyFor(winnerRow.drivers);
      const latestProfile = driverWinsAllEra.get(driverKey);
      winner = toDriver(winnerRow.drivers, winnerRow.teams);
      if (!winner.headshotUrl && latestProfile?.driver.headshotUrl) {
        winner.headshotUrl = latestProfile.driver.headshotUrl;
      }
    }

    return {
      raceId: race.id,
      raceName: race.name,
      raceDate: race.raceDate,
      year: new Date(race.raceDate).getFullYear(),
      hasSprint: (SPRINT_FORMATS as readonly string[]).includes(race.eventFormat),
      winner,
    };
  });
}

export function computeQualifyingImpactStats(winnerRows: WinnerRow[]): CircuitDetailResponse['qualifyingImpact'] {
  let poleWins = 0;
  let totalWinnerGridPos = 0;
  const completedWinnerCount = winnerRows.length;

  for (const winner of winnerRows) {
    const gridPos = winner.race_results.gridPosition;
    if (gridPos === 1) poleWins++;
    totalWinnerGridPos += gridPos !== null && gridPos !== undefined ? gridPos : 1;
  }

  return {
    poleToWinRate: completedWinnerCount > 0 ? poleWins / completedWinnerCount : 0,
    avgWinnerGridPos: completedWinnerCount > 0 ? totalWinnerGridPos / completedWinnerCount : 1.0,
  };
}

export function computeWeatherStats(raceRows: RaceRow[]): CircuitDetailResponse['weatherStats'] {
  const weatherStats = { dry: 0, wet: 0, mixed: 0, unknown: 0 };

  for (const race of raceRows) {
    const weather = (race.weather || '').toLowerCase();
    if (weather.includes('wet') || weather.includes('rain')) weatherStats.wet++;
    else if (weather.includes('mixed') || weather.includes('changeable')) weatherStats.mixed++;
    else if (weather.includes('dry') || weather.includes('clear') || weather.includes('sunny') || weather.includes('cloudy')) weatherStats.dry++;
    else weatherStats.unknown++;
  }

  return weatherStats;
}

export function computeSafetyCarStats(raceRows: RaceRow[]): CircuitDetailResponse['safetyCarStats'] {
  let completedRacesWithScData = 0;
  let totalScLaps = 0;
  let racesWithSc = 0;

  for (const race of raceRows) {
    if (race.safetyCarLaps !== null && race.safetyCarLaps !== undefined) {
      completedRacesWithScData++;
      totalScLaps += race.safetyCarLaps;
      if (race.safetyCarLaps > 0) racesWithSc++;
    }
  }

  return {
    avgScLaps: completedRacesWithScData > 0 ? totalScLaps / completedRacesWithScData : 0,
    scRaceRate: completedRacesWithScData > 0 ? racesWithSc / completedRacesWithScData : 0,
  };
}

export function pickFastestLap(lapRows: FastestLapRow[]): CircuitDetailResponse['fastestLap'] {
  if (lapRows.length === 0) return null;
  const row = lapRows[0];
  return {
    timeMs: row.lap_times.lapTimeMs!,
    driver: toDriver(row.drivers, row.teams),
    year: new Date(row.races.raceDate).getFullYear(),
  };
}
