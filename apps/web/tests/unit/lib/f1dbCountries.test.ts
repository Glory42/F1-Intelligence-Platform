import { describe, expect, test } from 'vitest';
import { f1dbCountryFlag, f1dbCountryName } from '../../../src/lib/f1dbCountries';

describe('f1dbCountryFlag', () => {
  test('builds the flag from the ISO code behind an F1DB country id', () => {
    expect(f1dbCountryFlag('united-kingdom')).toBe('🇬🇧');
    expect(f1dbCountryFlag('netherlands')).toBe('🇳🇱');
  });

  test('falls back to a chequered flag for unknown or missing countries', () => {
    expect(f1dbCountryFlag('rhodesia')).toBe('🏁');
    expect(f1dbCountryFlag(null)).toBe('🏁');
  });
});

describe('f1dbCountryName', () => {
  test('title-cases the id and keeps short words lower-case', () => {
    expect(f1dbCountryName('new-zealand')).toBe('New Zealand');
    expect(f1dbCountryName('united-states-of-america')).toBe('United States');
  });
});
