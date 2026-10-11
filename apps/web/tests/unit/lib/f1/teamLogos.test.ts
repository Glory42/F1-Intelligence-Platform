import { describe, expect, test } from 'vitest';
import { getTeamLogo } from '../../../../src/lib/f1/teamLogos';

describe('getTeamLogo', () => {
  test('returns the known logo path for a current team key', () => {
    expect(getTeamLogo('mclaren')).toBe('/teams/mclaren.jpg');
  });

  test('is case-insensitive', () => {
    expect(getTeamLogo('MCLAREN')).toBe('/teams/mclaren.jpg');
  });

  test('returns null for a team with no logo file (e.g. a historical team)', () => {
    expect(getTeamLogo('lotus_f1')).toBeNull();
  });
});
