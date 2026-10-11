import { describe, expect, test } from 'vitest';
import { isRaceWeekCircuit, weatherSplit } from '../../../../src/features/circuits/circuitView';
import type { Race } from '../../../../src/types';

const race = (circuitKey: string, raceDate: string, status: Race['status']) =>
  ({ raceDate, status, circuit: { circuitKey } }) as Race;

describe('isRaceWeekCircuit', () => {
  const season = [race('monza', '2025-09-07', 'completed'), race('baku', '2025-09-21', 'scheduled'), race('cota', '2025-10-19', 'scheduled')];

  test('picks the circuit of the next race still to run', () => {
    expect(isRaceWeekCircuit(season, 'baku')).toBe(true);
    expect(isRaceWeekCircuit(season, 'cota')).toBe(false);
  });

  test("falls back to the season's last race once every race is done", () => {
    const done = season.map((r) => ({ ...r, status: 'completed' as const }));
    expect(isRaceWeekCircuit(done, 'cota')).toBe(true);
    expect(isRaceWeekCircuit([], 'cota')).toBe(false);
  });
});

describe('weatherSplit', () => {
  test('turns race counts into rounded percentages', () => {
    expect(weatherSplit({ dry: 6, wet: 1, mixed: 1, unknown: 2 })).toEqual({ dry: 75, mixed: 13, wet: 13, total: 8 });
    expect(weatherSplit({ dry: 0, wet: 0, mixed: 0, unknown: 0 })).toEqual({ dry: 0, mixed: 0, wet: 0, total: 0 });
  });
});
