import { describe, expect, test } from 'bun:test';
import {
  buildHistoryItems,
  buildProbPosMaps,
  buildWinnerMap,
  mergeHistoryByDateDesc,
  type HistoryPredictionRow,
} from '../../../../src/modules/predictions/prediction-history.helpers';
import type { drivers, teams, races, circuits } from '../../../../src/db/schema';

const team: typeof teams.$inferSelect = {
  id: 1, seasonId: 2025, teamKey: 'red_bull', name: 'Red Bull Racing', nationality: 'Austrian',
  createdAt: new Date('2025-01-01T00:00:00Z'),
};

function driver(id: number, code: string): typeof drivers.$inferSelect {
  return {
    id, seasonId: 2025, teamId: 1, driverNumber: id, code,
    firstName: code, lastName: `Last${id}`, nationality: 'Dutch', headshotUrl: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
  };
}

const circuit: typeof circuits.$inferSelect = {
  id: 5, circuitKey: 'monza', name: 'Monza', country: 'Italy', city: 'Monza',
  lapCount: 53, trackLengthKm: '5.793', overtakeRate: '0.850', numberOfCorners: 11, drsZones: 2,
  scProbability: '0.300', imageUrl: null, trackCategory: 'high_speed', createdAt: new Date('2025-01-01T00:00:00Z'),
};

type RaceStatus = (typeof races.$inferSelect)['status'];

function race(id: number, raceDate: string, status: RaceStatus): typeof races.$inferSelect {
  return {
    id, seasonId: 2025, circuitId: 5, roundNumber: id, name: `Race ${id}`,
    raceDate, raceDateUtc: new Date(`${raceDate}T13:00:00Z`), status,
    eventFormat: 'conventional', qualifyingDate: null, sprintDate: null, sprintQualifyingDate: null,
    weather: 'dry', safetyCarLaps: 0, vscLaps: 0, airTempAvg: null, trackTempAvg: null, humidityAvg: null,
    sprintWeather: null, sprintSafetyCarLaps: null, sprintVscLaps: null, sprintAirTempAvg: null,
    sprintTrackTempAvg: null, sprintHumidityAvg: null, openf1RaceSessionKey: null, openf1SprintSessionKey: null, createdAt: new Date('2025-01-01T00:00:00Z'),
  };
}

function predRow(raceId: number, raceDate: string, status: RaceStatus, d: typeof drivers.$inferSelect): HistoryPredictionRow {
  return { race: race(raceId, raceDate, status), circuit, driver: d, team, computedAt: new Date(`${raceDate}T12:00:00Z`) };
}

const GP_DONE = (s: string) => s === 'completed';

describe('buildWinnerMap', () => {
  test('keys drivers by race id', () => {
    const map = buildWinnerMap([{ raceId: 7, driver: driver(10, 'VER'), team }]);
    expect(map.get(7)?.code).toBe('VER');
    expect(map.get(7)?.fullName).toBe('VER Last10');
  });
});

describe('buildProbPosMaps', () => {
  test('builds race:driver keyed prob + pos maps, skipping null positions', () => {
    const { probMap, posMap } = buildProbPosMaps([
      { raceId: 1, driverId: 10, winProbability: '0.40', predictedPosition: 2 },
      { raceId: 1, driverId: 11, winProbability: '0.10', predictedPosition: null },
    ]);
    expect(probMap.get('1:10')).toBe('0.40');
    expect(posMap.get('1:10')).toBe(2);
    expect(probMap.get('1:11')).toBe('0.10');
    expect(posMap.has('1:11')).toBe(false);
  });
});

describe('buildHistoryItems', () => {
  const ver = driver(10, 'VER');
  const ham = driver(11, 'HAM');

  test('marks a completed race correct when predicted winner actually won', () => {
    const [item] = buildHistoryItems([predRow(1, '2025-03-01', 'completed', ver)], {
      actualWinnerMap: buildWinnerMap([{ raceId: 1, driver: ver, team }]),
      probMap: new Map([['1:10', '0.55']]),
      posMap: new Map([['1:10', 1]]),
      isDone: GP_DONE,
      isSprint: false,
    });
    expect(item.correct).toBe(true);
    expect(item.winProbability).toBe('0.55');
    expect(item.actualWinner?.code).toBe('VER');
    expect(item.isSprint).toBe(false);
  });

  test('records the actual winner predicted position when the prediction missed', () => {
    const [item] = buildHistoryItems([predRow(2, '2025-04-01', 'completed', ver)], {
      actualWinnerMap: buildWinnerMap([{ raceId: 2, driver: ham, team }]),
      probMap: new Map([['2:10', '0.60']]),
      posMap: new Map([['2:11', 4]]),
      isDone: GP_DONE,
      isSprint: false,
    });
    expect(item.correct).toBe(false);
    expect(item.actualWinner?.code).toBe('HAM');
    expect(item.actualWinnerPredictedPosition).toBe(4);
  });

  test('a race that is not done yet has null correct / actualWinner and 0 default probability', () => {
    const [item] = buildHistoryItems([predRow(3, '2025-05-01', 'qualifying_done', ver)], {
      actualWinnerMap: new Map(),
      probMap: new Map(),
      posMap: new Map(),
      isDone: GP_DONE,
      isSprint: false,
    });
    expect(item.correct).toBeNull();
    expect(item.actualWinner).toBeNull();
    expect(item.actualWinnerPredictedPosition).toBeNull();
    expect(item.winProbability).toBe('0');
  });

  test('sprint isDone predicate is honoured', () => {
    const [item] = buildHistoryItems([predRow(4, '2025-06-01', 'sprint_done', ver)], {
      actualWinnerMap: buildWinnerMap([{ raceId: 4, driver: ver, team }]),
      probMap: new Map([['4:10', '0.5']]),
      posMap: new Map([['4:10', 1]]),
      isDone: (s) => ['sprint_done', 'qualifying_done', 'completed'].includes(s),
      isSprint: true,
    });
    expect(item.correct).toBe(true);
    expect(item.isSprint).toBe(true);
  });
});

describe('mergeHistoryByDateDesc', () => {
  test('flattens groups and sorts by race date, newest first', () => {
    const ver = driver(10, 'VER');
    const gp = buildHistoryItems(
      [predRow(1, '2025-03-01', 'completed', ver), predRow(3, '2025-07-01', 'completed', ver)],
      { actualWinnerMap: new Map(), probMap: new Map(), posMap: new Map(), isDone: GP_DONE, isSprint: false },
    );
    const sprint = buildHistoryItems(
      [predRow(2, '2025-05-01', 'sprint_done', ver)],
      { actualWinnerMap: new Map(), probMap: new Map(), posMap: new Map(), isDone: () => true, isSprint: true },
    );
    expect(mergeHistoryByDateDesc(gp, sprint).map((i) => i.raceDate)).toEqual([
      '2025-07-01', '2025-05-01', '2025-03-01',
    ]);
  });
});
