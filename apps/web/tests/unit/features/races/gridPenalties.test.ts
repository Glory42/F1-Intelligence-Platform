import { describe, expect, it } from 'vitest';
import { gridDrops } from '@/features/races/gridPenalties';

const entry = (driverId: number, code: string) => ({ driverId, driver: { code } });

describe('gridDrops', () => {
  it('reports drivers who started behind where they qualified, and pit-lane starts', () => {
    const qualifying = [
      { ...entry(1, 'VER'), gridPosition: 3 },
      { ...entry(2, 'NOR'), gridPosition: 4 },
      { ...entry(3, 'HAM'), gridPosition: 9 },
    ];
    const results = [
      { ...entry(1, 'VER'), gridPosition: 13 },
      { ...entry(2, 'NOR'), gridPosition: 3 },
      { ...entry(3, 'HAM'), gridPosition: 0 },
    ];

    expect(gridDrops(results, qualifying)).toEqual([
      { code: 'VER', qualified: 3, started: 13, places: 10, pitLane: false },
      { code: 'HAM', qualified: 9, started: null, places: null, pitLane: true },
    ]);
  });
});
