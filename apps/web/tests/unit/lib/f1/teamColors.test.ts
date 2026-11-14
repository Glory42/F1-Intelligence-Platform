import { describe, expect, test } from 'vitest';
import { getTeamColor, readableOnBlack } from '../../../../src/lib/f1/teamColors';

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

describe('readableOnBlack', () => {
  const contrast = (hex: string) => {
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
    return (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05) / 0.05;
  };

  test('keeps a team colour that already reads on black', () => {
    expect(readableOnBlack('#FF8000')).toBe('#FF8000');
  });

  test('lightens dark team colours just past 4.5:1', () => {
    for (const hex of ['#E8002D', '#6B7280', '#00205B', '#000000']) {
      const text = readableOnBlack(hex);
      expect(contrast(text)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(text)).toBeLessThan(6);
    }
  });
});
