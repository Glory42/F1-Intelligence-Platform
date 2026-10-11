import { describe, expect, it } from 'vitest';
import { legacyRedirect } from '@/lib/legacyRedirects';

describe('legacyRedirect', () => {
  it("sends a season's old prediction recap to that season's Scorecard", () => {
    expect(legacyRedirect('/prediction/recap/2025')).toBe('/prediction?tab=scorecard&year=2025');
    expect(legacyRedirect('/prediction/recap/2025/')).toBe('/prediction?tab=scorecard&year=2025');
  });

  it('sends the old recap index to the current Scorecard', () => {
    expect(legacyRedirect('/prediction/recap')).toBe('/prediction?tab=scorecard');
  });

  it('moves compare and history to their own sections, keeping the query string', () => {
    expect(legacyRedirect('/drivers/compare', '?a=1&b=2')).toBe('/compare/drivers?a=1&b=2');
    expect(legacyRedirect('/teams/compare/')).toBe('/compare/teams');
    expect(legacyRedirect('/compare')).toBe('/compare/drivers');
    expect(legacyRedirect('/records', '?tab=lineage')).toBe('/history?tab=lineage');
  });

  it('leaves every other page alone', () => {
    expect(legacyRedirect('/prediction')).toBeNull();
    expect(legacyRedirect('/prediction/42')).toBeNull();
    expect(legacyRedirect('/prediction/recap/latest')).toBeNull();
  });
});
