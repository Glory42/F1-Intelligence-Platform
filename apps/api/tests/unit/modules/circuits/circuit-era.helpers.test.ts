import { describe, expect, test } from 'bun:test';
import {
  normalizeTeamKey,
  driverKeyFor,
  aggregateEraWins,
  buildDominanceByEra,
} from '../../../../src/modules/circuits/circuit-era.helpers';
import type { WinnerRow } from '../../../../src/modules/circuits/circuit-stats.helpers';
import type { races, drivers, teams } from '../../../../src/db/schema';

type RaceRow = typeof races.$inferSelect;
type DriverRow = typeof drivers.$inferSelect;
type TeamRow = typeof teams.$inferSelect;

function team(over: Partial<TeamRow> = {}): TeamRow {
  return {
    id: 1, seasonId: 2024, teamKey: 'red_bull_racing', name: 'Red Bull Racing', nationality: 'Austrian',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...over,
  };
}

function driver(over: Partial<DriverRow> = {}): DriverRow {
  return {
    id: 1, seasonId: 2024, teamId: 1, driverNumber: 1, code: 'VER',
    firstName: 'Max', lastName: 'Verstappen', nationality: 'Dutch', headshotUrl: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...over,
  };
}

function race(id: number, raceDate: string): RaceRow {
  return {
    id, seasonId: 2024, circuitId: 1, roundNumber: 1, name: `GP ${id}`,
    raceDate, raceDateUtc: null, status: 'completed', eventFormat: 'conventional',
    qualifyingDate: null, sprintDate: null, sprintQualifyingDate: null,
    weather: 'dry', safetyCarLaps: 0, vscLaps: 0,
    airTempAvg: null, trackTempAvg: null, humidityAvg: null,
    sprintWeather: null, sprintSafetyCarLaps: null, sprintVscLaps: null,
    sprintAirTempAvg: null, sprintTrackTempAvg: null, sprintHumidityAvg: null, openf1RaceSessionKey: null, openf1SprintSessionKey: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
  };
}

function winner(raceId: number, d: DriverRow, t: TeamRow): WinnerRow {
  return {
    race_results: { id: raceId, raceId, driverId: d.id, finishPosition: 1, gridPosition: 1,
      points: '25.0', status: 'Finished', fastestLap: false } as WinnerRow['race_results'],
    drivers: d,
    teams: t,
  };
}

describe('normalizeTeamKey', () => {
  test('folds rebrand aliases onto one canonical key', () => {
    expect(normalizeTeamKey('rb')).toBe('racing_bulls');
    expect(normalizeTeamKey('alphatauri')).toBe('alpha_tauri');
    expect(normalizeTeamKey('red_bull')).toBe('red_bull_racing');
  });

  test('passes an unknown key through unchanged', () => {
    expect(normalizeTeamKey('ferrari')).toBe('ferrari');
  });
});

describe('driverKeyFor', () => {
  test('keys on full name', () => {
    expect(driverKeyFor(driver({ firstName: 'Lewis', lastName: 'Hamilton' }))).toBe('Lewis Hamilton');
  });
});

describe('aggregateEraWins', () => {
  const raceOrder = new Map([[1, 0], [2, 1], [3, 2]]);

  test('places each win in "all" plus the era matching its year', () => {
    const raceMap = new Map([
      [1, race(1, '2024-05-01')], // modern
      [2, race(2, '2005-05-01')], // legacy
      [3, race(3, '1994-05-01')], // nineties
    ]);
    const rows = [
      winner(1, driver({ id: 1, firstName: 'A', lastName: 'One' }), team()),
      winner(2, driver({ id: 2, firstName: 'B', lastName: 'Two' }), team()),
      winner(3, driver({ id: 3, firstName: 'C', lastName: 'Three' }), team()),
    ];
    const { driverWinsByEra } = aggregateEraWins(rows, raceMap, raceOrder);
    expect(driverWinsByEra.all.size).toBe(3);
    expect([...driverWinsByEra.modern.keys()]).toEqual(['A One']);
    expect([...driverWinsByEra.legacy.keys()]).toEqual(['B Two']);
    expect([...driverWinsByEra.nineties.keys()]).toEqual(['C Three']);
  });

  test('merges wins across rebranded team keys and counts them together', () => {
    const raceMap = new Map([[1, race(1, '2024-05-01')], [2, race(2, '2024-06-01')]]);
    const rows = [
      winner(1, driver(), team({ teamKey: 'red_bull' })),
      winner(2, driver(), team({ teamKey: 'red_bull_racing' })),
    ];
    const { teamWinsByEra } = aggregateEraWins(rows, raceMap, raceOrder);
    expect(teamWinsByEra.all.size).toBe(1);
    expect(teamWinsByEra.all.get('red_bull_racing')?.wins).toBe(2);
  });

  test('a win before 1990 lands only in "all"', () => {
    const raceMap = new Map([[1, race(1, '1985-05-01')]]);
    const { driverWinsByEra } = aggregateEraWins([winner(1, driver(), team())], raceMap, raceOrder);
    expect(driverWinsByEra.all.size).toBe(1);
    expect(driverWinsByEra.modern.size + driverWinsByEra.legacy.size + driverWinsByEra.nineties.size).toBe(0);
  });

  test('keeps the earliest-ordered row as the canonical driver profile', () => {
    const raceMap = new Map([[1, race(1, '2024-05-01')], [2, race(2, '2024-06-01')]]);
    const early = driver({ id: 9, headshotUrl: 'https://cdn/early.png' });
    const late = driver({ id: 9, headshotUrl: 'https://cdn/late.png' });
    // race 2 has the lower raceOrder idx here, so its row should win.
    const order = new Map([[1, 5], [2, 1]]);
    const { driverWinsByEra } = aggregateEraWins(
      [winner(1, early, team()), winner(2, late, team())],
      raceMap,
      order,
    );
    const entry = driverWinsByEra.all.get('Max Verstappen');
    expect(entry?.wins).toBe(2);
    expect(entry?.driver.headshotUrl).toBe('https://cdn/late.png');
  });
});

describe('buildDominanceByEra', () => {
  test('sorts constructors and drivers by wins descending and maps to DTOs', () => {
    const raceMap = new Map([[1, race(1, '2024-05-01')], [2, race(2, '2024-06-01')], [3, race(3, '2024-07-01')]]);
    const order = new Map([[1, 0], [2, 1], [3, 2]]);
    const ferrari = team({ id: 2, teamKey: 'ferrari', name: 'Ferrari' });
    const rows = [
      winner(1, driver({ id: 1, firstName: 'Max', lastName: 'Verstappen' }), team()),
      winner(2, driver({ id: 1, firstName: 'Max', lastName: 'Verstappen' }), team()),
      winner(3, driver({ id: 2, firstName: 'Charles', lastName: 'Leclerc' }), ferrari),
    ];
    const { teamWinsByEra, driverWinsByEra } = aggregateEraWins(rows, raceMap, order);
    const dominance = buildDominanceByEra(teamWinsByEra, driverWinsByEra);

    expect(dominance.all.constructors.map((c) => [c.team.name, c.wins])).toEqual([
      ['Red Bull Racing', 2],
      ['Ferrari', 1],
    ]);
    expect(dominance.all.drivers[0]).toMatchObject({ wins: 2 });
    expect(dominance.all.drivers[0].driver.fullName).toBe('Max Verstappen');
  });
});
