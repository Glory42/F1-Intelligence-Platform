import { describe, expect, test } from 'bun:test';
import {
  buildCircuitHistory,
  computeQualifyingImpactStats,
  computeWeatherStats,
  computeSafetyCarStats,
  pickFastestLap,
  type WinnerRow,
  type FastestLapRow,
} from '../../../../src/modules/races/circuit-stats.helpers';
import type { DriverWinEntry } from '../../../../src/modules/races/circuit-era.helpers';
import type { races, drivers, teams } from '../../../../src/db/schema';

type RaceRow = typeof races.$inferSelect;
type DriverRow = typeof drivers.$inferSelect;
type TeamRow = typeof teams.$inferSelect;

const team: TeamRow = {
  id: 1, seasonId: 2024, teamKey: 'mclaren', name: 'McLaren', nationality: 'British',
  createdAt: new Date('2024-01-01T00:00:00Z'),
};

function driver(over: Partial<DriverRow> = {}): DriverRow {
  return {
    id: 10, seasonId: 2024, teamId: 1, driverNumber: 4, code: 'NOR',
    firstName: 'Lando', lastName: 'Norris', nationality: 'British', headshotUrl: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...over,
  };
}

function race(over: Partial<RaceRow> = {}): RaceRow {
  return {
    id: 1, seasonId: 2024, circuitId: 1, roundNumber: 1, name: 'Test GP',
    raceDate: '2024-05-01', raceDateUtc: null, status: 'completed', eventFormat: 'conventional',
    qualifyingDate: null, sprintDate: null, sprintQualifyingDate: null,
    weather: 'dry', safetyCarLaps: 0, vscLaps: 0,
    airTempAvg: null, trackTempAvg: null, humidityAvg: null,
    sprintWeather: null, sprintSafetyCarLaps: null, sprintVscLaps: null,
    sprintAirTempAvg: null, sprintTrackTempAvg: null, sprintHumidityAvg: null, openf1RaceSessionKey: null, openf1SprintSessionKey: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...over,
  };
}

function winnerRow(raceId: number, gridPosition: number | null, d: DriverRow = driver()): WinnerRow {
  return {
    race_results: {
      id: raceId, raceId, driverId: d.id, finishPosition: 1, gridPosition,
      points: '25.0', status: 'Finished', fastestLap: false,
    } as WinnerRow['race_results'],
    drivers: d,
    teams: team,
  };
}

describe('buildCircuitHistory', () => {
  test('truncates to the limit and derives year + hasSprint per race', () => {
    const rows = [
      race({ id: 1, raceDate: '2024-05-01', eventFormat: 'sprint' }),
      race({ id: 2, raceDate: '2023-05-01' }),
      race({ id: 3, raceDate: '2022-05-01' }),
    ];
    const history = buildCircuitHistory(rows, new Map(), new Map(), 2);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ raceId: 1, year: 2024, hasSprint: true, winner: null });
    expect(history[1].hasSprint).toBe(false);
  });

  test('backfills a missing winner headshot from the all-era profile', () => {
    const winnerMap = new Map([[1, winnerRow(1, 1, driver({ headshotUrl: null }))]]);
    const allEra = new Map<string, DriverWinEntry>([
      ['Lando Norris', { driver: driver({ headshotUrl: 'https://cdn/nor.png' }), team, wins: 3, bestIdx: 0 }],
    ]);
    const [item] = buildCircuitHistory([race({ id: 1 })], winnerMap, allEra, 5);
    expect(item.winner?.headshotUrl).toBe('https://cdn/nor.png');
  });

  test('keeps the winner headshot when the row already has one', () => {
    const winnerMap = new Map([[1, winnerRow(1, 1, driver({ headshotUrl: 'https://cdn/original.png' }))]]);
    const allEra = new Map<string, DriverWinEntry>([
      ['Lando Norris', { driver: driver({ headshotUrl: 'https://cdn/other.png' }), team, wins: 3, bestIdx: 0 }],
    ]);
    const [item] = buildCircuitHistory([race({ id: 1 })], winnerMap, allEra, 5);
    expect(item.winner?.headshotUrl).toBe('https://cdn/original.png');
  });
});

describe('computeQualifyingImpactStats', () => {
  test('counts pole-to-win and averages winner grid position', () => {
    const stats = computeQualifyingImpactStats([winnerRow(1, 1), winnerRow(2, 3)]);
    expect(stats.poleToWinRate).toBe(0.5);
    expect(stats.avgWinnerGridPos).toBe(2);
  });

  test('treats a null grid position as 1', () => {
    const stats = computeQualifyingImpactStats([winnerRow(1, null)]);
    expect(stats.avgWinnerGridPos).toBe(1);
    expect(stats.poleToWinRate).toBe(0);
  });

  test('returns neutral values with no winners', () => {
    expect(computeQualifyingImpactStats([])).toEqual({ poleToWinRate: 0, avgWinnerGridPos: 1.0 });
  });
});

describe('computeWeatherStats', () => {
  test('buckets each race by weather keyword, unknown for anything else', () => {
    const stats = computeWeatherStats([
      race({ weather: 'Heavy Rain' }),
      race({ weather: 'wet' }),
      race({ weather: 'Changeable' }),
      race({ weather: 'Sunny' }),
      race({ weather: 'dry' }),
      race({ weather: 'foggy' }),
      race({ weather: null }),
    ]);
    expect(stats).toEqual({ dry: 2, wet: 2, mixed: 1, unknown: 2 });
  });
});

describe('computeSafetyCarStats', () => {
  test('averages only over races that carry safety-car data', () => {
    const stats = computeSafetyCarStats([
      race({ safetyCarLaps: 4 }),
      race({ safetyCarLaps: 0 }),
      race({ safetyCarLaps: null }),
    ]);
    expect(stats.avgScLaps).toBe(2);
    expect(stats.scRaceRate).toBe(0.5);
  });

  test('returns zeroes when no race has safety-car data', () => {
    expect(computeSafetyCarStats([race({ safetyCarLaps: null })])).toEqual({ avgScLaps: 0, scRaceRate: 0 });
  });
});

describe('pickFastestLap', () => {
  test('returns null for an empty lap set', () => {
    expect(pickFastestLap([])).toBeNull();
  });

  test('maps the first (fastest) lap row', () => {
    const row: FastestLapRow = {
      lap_times: { lapTimeMs: 78123 } as FastestLapRow['lap_times'],
      drivers: driver(),
      teams: team,
      races: race({ raceDate: '2021-09-01' }),
    };
    expect(pickFastestLap([row])).toEqual({
      timeMs: 78123,
      driver: expect.objectContaining({ code: 'NOR' }),
      year: 2021,
    });
  });
});
