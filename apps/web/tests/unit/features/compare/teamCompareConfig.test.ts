import { describe, expect, test } from 'vitest';
import { seasonStatConfig } from '../../../../src/features/compare/teamCompareConfig';
import type { TeamSeasonStats } from '../../../../src/types';

describe('seasonStatConfig', () => {
  test('championship points come from the API, matching the standings', () => {
    const row = seasonStatConfig.find((r) => r.label === 'Championship Points')!;
    const stats = { totalPoints: '560.0', sprintTotalPoints: '40.0', championshipPoints: '612.0' } as TeamSeasonStats;
    expect(row.value(stats)).toBe(612);
  });
});
