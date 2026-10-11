import { describe, expect, it } from 'vitest';
import { raceHighlights } from '@/features/hub/raceHighlights';

const driver = (id: number, code: string) => ({ id, code });
const result = (id: number, code: string, finishPosition: number | null, fastestLap = false) =>
  ({ driverId: id, finishPosition, fastestLap, driver: driver(id, code) });

describe('raceHighlights', () => {
  it('picks the podium in finishing order, the pole sitter, the fastest lap and the retirements', () => {
    const results = [
      result(3, 'NOR', 3), result(4, 'SAI', null), result(1, 'VER', 1),
      result(2, 'LEC', 2, true), result(5, 'ALB', null), result(6, 'GAS', 4),
    ];
    const qualifying = [{ gridPosition: 2, driver: driver(1, 'VER') }, { gridPosition: 1, driver: driver(2, 'LEC') }];

    const highlights = raceHighlights(results, qualifying);

    expect(highlights.podium.map((r) => r.driver.code)).toEqual(['VER', 'LEC', 'NOR']);
    expect(highlights.pole?.code).toBe('LEC');
    expect(highlights.fastestLap?.code).toBe('LEC');
    expect(highlights.retirements).toBe(2);
  });

  it('has no pole or fastest lap when that data is missing', () => {
    const highlights = raceHighlights([result(1, 'VER', 1)], []);

    expect(highlights.pole).toBeNull();
    expect(highlights.fastestLap).toBeNull();
    expect(highlights.retirements).toBe(0);
  });
});
