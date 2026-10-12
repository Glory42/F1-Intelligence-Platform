import { describe, expect, test } from 'vitest';
import { seasonStatConfig } from '../../../../src/features/compare/driverCompareConfig';
import type { DriverSeasonStats } from '../../../../src/types';

describe('seasonStatConfig', () => {
  test('championship points come from the API, matching the standings', () => {
    const row = seasonStatConfig.find((r) => r.label === 'Championship Points')!;
    const stats = { totalPoints: '309.0', sprintTotalPoints: '31.0', championshipPoints: '345.0' } as DriverSeasonStats;
    expect(row.value(stats)).toBe(345);
  });
});
