import { describe, expect, it } from 'vitest';
import { rainSpells } from '@/lib/weatherSpells';

describe('rainSpells', () => {
  it('groups consecutive wet samples into spells by minute', () => {
    const minutes = [0, 1, 2, 3, 4, 5, 6];
    const rain = [false, true, true, false, false, true, true];

    expect(rainSpells(minutes, rain)).toEqual([{ from: 1, to: 2 }, { from: 5, to: 6 }]);
  });

  it('returns no spells for a dry session', () => {
    expect(rainSpells([0, 1], [false, false])).toEqual([]);
  });
});
