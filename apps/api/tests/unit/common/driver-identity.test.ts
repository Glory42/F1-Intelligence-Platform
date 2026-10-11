import { describe, expect, it } from 'bun:test';
import { isSamePerson } from '../../../src/common/driver-identity';

const row = (code: string, firstName: string, lastName: string) => ({ code, firstName, lastName });

describe('isSamePerson', () => {
  it('links seasons whose names differ only by accents or case', () => {
    expect(isSamePerson(row('HUL', 'Nico', 'Hülkenberg'), row('HUL', 'Nico', 'Hulkenberg'))).toBe(true);
    expect(isSamePerson(row('PER', 'Sergio', 'Pérez'), row('PER', 'Sergio', 'Perez'))).toBe(true);
  });

  it('links a season that adds a middle name, as long as the code matches', () => {
    expect(isSamePerson(row('ANT', 'Andrea', 'Kimi Antonelli'), row('ANT', 'Kimi', 'Antonelli'))).toBe(true);
    expect(isSamePerson(row('XYZ', 'Andrea', 'Kimi Antonelli'), row('ANT', 'Kimi', 'Antonelli'))).toBe(false);
  });

  it('keeps fathers and sons apart', () => {
    expect(isSamePerson(row('PIQ', 'Nelson', 'Piquet'), row('PIQ', 'Nelson', 'Piquet Jr.'))).toBe(false);
    expect(isSamePerson(row('MSC', 'Michael', 'Schumacher'), row('MSC', 'Mick', 'Schumacher'))).toBe(false);
  });
});
