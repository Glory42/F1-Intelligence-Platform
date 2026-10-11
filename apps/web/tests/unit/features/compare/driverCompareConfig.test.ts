import { describe, expect, test } from 'vitest';
import { seasonStatConfig } from '../../../../src/features/compare/driverCompareConfig';
import type { DriverSeasonStats } from '../../../../src/types';

describe('seasonStatConfig', () => {
  test('championship points include sprint points, matching the standings', () => {
    const row = seasonStatConfig.find((r) => r.label === 'Championship Points')!;
    const stats = { totalPoints: '309.0', sprintTotalPoints: '31.0' } as DriverSeasonStats;
    expect(row.value(stats)).toBe(340);
  });
});
