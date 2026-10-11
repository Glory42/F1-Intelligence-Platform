import { describe, expect, test } from 'vitest';
import { getTeamColor } from '../../../../src/lib/f1/teamColors';

describe('getTeamColor', () => {
  test('returns the known hex color for a current team key', () => {
    expect(getTeamColor('ferrari')).toBe('#E8002D');
  });

  test('is case-insensitive', () => {
    expect(getTeamColor('FERRARI')).toBe('#E8002D');
  });

  test('falls back to the neutral gray for an unknown key', () => {
    expect(getTeamColor('not_a_real_team')).toBe('#6B7280');
  });
});
