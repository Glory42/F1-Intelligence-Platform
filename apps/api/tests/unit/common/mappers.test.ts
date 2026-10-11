import { describe, expect, test, afterEach } from 'bun:test';
import { toTeam, toDriver, toCircuit, toRace } from '../../../src/common/mappers';
import type { teams, drivers, races, circuits } from '../../../src/db/schema';

type TeamRow = typeof teams.$inferSelect;
type DriverRow = typeof drivers.$inferSelect;
type RaceRow = typeof races.$inferSelect;
type CircuitRow = typeof circuits.$inferSelect;

const team: TeamRow = {
  id: 1,
  seasonId: 2025,
  teamKey: 'red-bull',
  name: 'Red Bull Racing',
  nationality: 'Austrian',
  createdAt: new Date('2025-01-01T00:00:00Z'),
};

const driver: DriverRow = {
  id: 10,
  seasonId: 2025,
  teamId: 1,
  driverNumber: 1,
  code: 'VER',
  firstName: 'Max',
  lastName: 'Verstappen',
  nationality: 'Dutch',
  headshotUrl: null,
  createdAt: new Date('2025-01-01T00:00:00Z'),
};

const circuit: CircuitRow = {
  id: 5,
  circuitKey: 'monza',
  name: 'Autodromo Nazionale Monza',
  country: 'Italy',
  city: 'Monza',
  lapCount: 53,
  trackLengthKm: '5.793',
  overtakeRate: '0.850',
  numberOfCorners: 11,
  drsZones: 2,
  scProbability: '0.300',
  imageUrl: null,
  trackCategory: 'high_speed',
  createdAt: new Date('2025-01-01T00:00:00Z'),
};

const race: RaceRow = {
  id: 100,
  seasonId: 2025,
  circuitId: 5,
  roundNumber: 16,
  name: 'Italian Grand Prix',
  raceDate: '2025-09-07',
  raceDateUtc: new Date('2025-09-07T13:00:00Z'),
  status: 'completed',
  eventFormat: 'conventional',
  qualifyingDate: new Date('2025-09-06T14:00:00Z'),
  sprintDate: null,
  sprintQualifyingDate: null,
  weather: 'dry',
  safetyCarLaps: 0,
  vscLaps: 0,
  airTempAvg: '24.5',
  trackTempAvg: '38.2',
  humidityAvg: '45.0',
  sprintWeather: null,
  sprintSafetyCarLaps: null,
  sprintVscLaps: null,
  sprintAirTempAvg: null,
  sprintTrackTempAvg: null,
  sprintHumidityAvg: null, openf1RaceSessionKey: null, openf1SprintSessionKey: null,
  createdAt: new Date('2025-01-01T00:00:00Z'),
};

describe('toTeam', () => {
  test('maps schema row to Team', () => {
    expect(toTeam(team)).toEqual({
      id: 1,
      seasonId: 2025,
      teamKey: 'red-bull',
      name: 'Red Bull Racing',
      nationality: 'Austrian',
    });
  });
});

describe('toDriver', () => {
  test('concatenates full name and nests the team', () => {
    const result = toDriver(driver, team);
    expect(result.fullName).toBe('Max Verstappen');
    expect(result.team).toEqual(toTeam(team));
  });

  test('null headshotUrl passes through as null', () => {
    expect(toDriver(driver, team).headshotUrl).toBeNull();
  });
});

describe('toCircuit', () => {
  const originalR2Url = process.env.R2_PUBLIC_URL;
  afterEach(() => {
    if (originalR2Url === undefined) delete process.env.R2_PUBLIC_URL;
    else process.env.R2_PUBLIC_URL = originalR2Url;
  });

  test('absolute imageUrl passes through unchanged', () => {
    const result = toCircuit({ ...circuit, imageUrl: 'https://cdn.example.com/monza.jpg' });
    expect(result.imageUrl).toBe('https://cdn.example.com/monza.jpg');
  });

  test('relative imageUrl is prefixed with R2_PUBLIC_URL', () => {
    process.env.R2_PUBLIC_URL = 'https://r2.example.com/';
    const result = toCircuit({ ...circuit, imageUrl: '/circuits/monza.jpg' });
    expect(result.imageUrl).toBe('https://r2.example.com/circuits/monza.jpg');
  });

  test('relative imageUrl with no R2_PUBLIC_URL stays relative', () => {
    delete process.env.R2_PUBLIC_URL;
    const result = toCircuit({ ...circuit, imageUrl: '/circuits/monza.jpg' });
    expect(result.imageUrl).toBe('/circuits/monza.jpg');
  });

  test('null imageUrl falls back to circuitKey with R2_PUBLIC_URL', () => {
    process.env.R2_PUBLIC_URL = 'https://r2.example.com';
    const result = toCircuit({ ...circuit, imageUrl: null });
    expect(result.imageUrl).toBe('https://r2.example.com/circuits/monza.jpg');
  });

  test('null imageUrl falls back to a relative circuitKey path with no R2_PUBLIC_URL', () => {
    delete process.env.R2_PUBLIC_URL;
    const result = toCircuit({ ...circuit, imageUrl: null });
    expect(result.imageUrl).toBe('/circuits/monza.jpg');
  });
});

describe('toRace', () => {
  test('hasSprint is true for sprint event formats', () => {
    expect(toRace({ ...race, eventFormat: 'sprint' }, circuit).hasSprint).toBe(true);
    expect(toRace({ ...race, eventFormat: 'sprint_qualifying' }, circuit).hasSprint).toBe(true);
  });

  test('hasSprint is false for conventional format', () => {
    expect(toRace(race, circuit).hasSprint).toBe(false);
  });

  test('converts timestamp columns to ISO strings', () => {
    const result = toRace(race, circuit);
    expect(result.raceDateUtc).toBe('2025-09-07T13:00:00.000Z');
    expect(result.qualifyingDate).toBe('2025-09-06T14:00:00.000Z');
  });

  test('null timestamp columns stay null', () => {
    const result = toRace(race, circuit);
    expect(result.sprintDate).toBeNull();
    expect(result.sprintQualifyingDate).toBeNull();
  });

  test('nests the mapped circuit', () => {
    expect(toRace(race, circuit).circuit).toEqual(toCircuit(circuit));
  });
});
