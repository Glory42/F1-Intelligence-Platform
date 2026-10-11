import { describe, expect, test } from 'vitest';
import {
  circuitYearItems, conditionsOf, fastestLapOf, predictedPodium, sprintQualifyingGrid, winnerOf,
} from '../../../../src/features/races/raceView';
import { NO_RACE_EVENTS, raceEventTabs } from '../../../../src/features/races/loadRaceEvents';
import type { CircuitHistoryItem, Driver, LapSummary, SprintResult } from '../../../../src/types';

const driver = (id: number, code: string): Driver => ({
  id, seasonId: 2025, teamId: 1, driverNumber: id, code, firstName: code, lastName: code, fullName: code,
  nationality: null, headshotUrl: null,
  team: { id: 1, seasonId: 2025, teamKey: 'mclaren', name: 'McLaren', nationality: 'British' },
});
const finish = (id: number, code: string, finishPosition: number | null, fastestLap = false) => ({
  driverId: id, driver: driver(id, code), finishPosition, fastestLap,
});

describe('race view helpers', () => {
  test('orders the predicted podium without touching the source list', () => {
    const drivers = [{ predictedPosition: 3 }, { predictedPosition: null }, { predictedPosition: 1 }];
    expect(predictedPodium(drivers, 2)).toEqual([{ predictedPosition: 1 }, { predictedPosition: 3 }]);
    expect(drivers[0]).toEqual({ predictedPosition: 3 });
  });

  test('finds the winner and the fastest lap with its time', () => {
    const results = [finish(1, 'NOR', 2, true), finish(2, 'PIA', 1)];
    const laps = [{ driverId: 1, fastestLapMs: 81_234 }] as LapSummary[];
    expect(winnerOf(results)?.driver.code).toBe('PIA');
    expect(fastestLapOf(results, laps)).toEqual({ code: 'NOR', timeStr: '1:21.234' });
    expect(fastestLapOf([finish(2, 'PIA', 1)], laps)).toBeNull();
  });

  test('lists only the conditions that were recorded', () => {
    expect(conditionsOf({ safetyCarLaps: 0, vscLaps: null, airTempAvg: '24.6', trackTempAvg: null, humidityAvg: '41' }))
      .toEqual([{ label: 'SC Laps', val: 0 }, { label: 'Air', val: '25°C' }, { label: 'Humidity', val: '41%' }]);
  });

  test('links other seasons at the circuit, sprint pages only to sprint weekends', () => {
    const history = [
      { raceId: 5, year: 2023, hasSprint: false },
      { raceId: 9, year: 2025, hasSprint: true },
    ] as CircuitHistoryItem[];
    expect(circuitYearItems(history, 'race')).toEqual([{ year: 2025, href: '/races/9' }, { year: 2023, href: '/races/5' }]);
    expect(circuitYearItems(history, 'sprint')).toEqual([{ year: 2025, href: '/races/9/sprint' }]);
  });

  test('turns sprint results into a qualifying grid in grid order', () => {
    const row = (id: number, gridPosition: number, sq3TimeMs: number | null) => ({
      id, driverId: id, gridPosition, sq1TimeMs: null, sq2TimeMs: null, sq3TimeMs, sqSector1Ms: null,
      sqSector2Ms: null, sqSector3Ms: null, sqSpeedSt: null, driver: driver(id, `D${id}`),
    }) as SprintResult;
    const grid = sprintQualifyingGrid([row(1, 2, 90_100), row(2, 1, 90_000)]);
    expect(grid.map((g) => [g.gridPosition, g.q3TimeMs])).toEqual([[1, 90_000], [2, 90_100]]);
  });
});

describe('raceEventTabs', () => {
  test('shows a tab only for feeds with data, plus team radio when it is expected to be sparse', () => {
    const events = { ...NO_RACE_EVENTS, overtakes: [{}] } as unknown as typeof NO_RACE_EVENTS;
    expect(raceEventTabs(events).map((t) => t.id)).toEqual(['overtakes']);
    expect(raceEventTabs(events, true).map((t) => t.id)).toEqual(['overtakes', 'team-radio']);
  });
});
