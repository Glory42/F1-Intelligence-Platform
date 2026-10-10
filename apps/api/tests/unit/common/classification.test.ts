import { describe, expect, it } from 'bun:test';
import { isClassifiedFinish } from '../../../src/common/classification';

// Mirrors compute_season_stats.py's DNF rule (docs/adr/0002): anything else is a non-finish.
describe('isClassifiedFinish', () => {
  it('counts finishers and lapped cars as classified', () => {
    expect(['Finished', 'Lapped', '+1 Lap', '+3 Laps'].map(isClassifiedFinish)).toEqual([true, true, true, true]);
  });

  it('treats retirements, disqualifications and non-starts as non-finishes', () => {
    expect(['Retired', 'Disqualified', 'Did not start', 'Accident', null].map(isClassifiedFinish)).toEqual([
      false, false, false, false, false,
    ]);
  });
});
