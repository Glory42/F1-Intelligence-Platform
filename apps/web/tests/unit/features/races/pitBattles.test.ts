import { describe, expect, it } from 'vitest';
import { formatBattleGap, pitBattleLine, pitBattleSummary } from '@/features/races/pitBattles';
import type { PitBattle } from '@/types';

const battle = (overrides: Partial<PitBattle>): PitBattle => ({
  attackerId: 4, defenderId: 81, attackerLap: 18, defenderLap: 20,
  gapBeforeMs: 1_400, gapAfterMs: -2_100, outcome: 'undercut', ...overrides,
});

describe('pitBattleLine', () => {
  it('tells an undercut from the side of the car that stopped first', () => {
    expect(pitBattleLine(battle({}))).toEqual({
      subjectId: 4, objectId: 81, verb: 'undercut', tone: 'gain',
      laps: 'pitted lap 18 vs 20', gaps: '1.4 s behind → 2.1 s ahead',
    });
  });

  it('credits an overcut to the car that stayed out, from its side', () => {
    expect(pitBattleLine(battle({ outcome: 'overcut', gapBeforeMs: -900, gapAfterMs: 1_500 }))).toMatchObject({
      subjectId: 81, objectId: 4, verb: 'overcut', laps: 'pitted lap 20 vs 18', gaps: '0.9 s behind → 1.5 s ahead',
    });
  });

  it('separates a failed undercut from a car covering off the one behind', () => {
    expect(pitBattleLine(battle({ outcome: 'held', gapAfterMs: 600 }))).toMatchObject({ verb: 'failed to undercut', tone: 'neutral' });
    expect(pitBattleLine(battle({ outcome: 'held', gapBeforeMs: -800, gapAfterMs: -1_200 }))).toMatchObject({ verb: 'covered', tone: 'neutral' });
  });

  it('keeps a stop under a Safety Car or VSC apart from strategy', () => {
    expect(pitBattleLine(battle({ outcome: 'sc-assisted' }))).toMatchObject({ verb: 'pitted before', tone: 'neutralised' });
  });
});

describe('formatBattleGap', () => {
  it('reads the gap from the car in the sentence, and has no figure once a car is lapped', () => {
    expect(formatBattleGap(2_060)).toBe('2.1 s behind');
    expect(formatBattleGap(-300)).toBe('0.3 s ahead');
    expect(formatBattleGap(null)).toBe('lapped');
  });
});

describe('pitBattleSummary', () => {
  it('counts what worked, leaving out stops under a Safety Car', () => {
    const battles = [
      battle({}), battle({}), battle({ outcome: 'overcut' }), battle({ outcome: 'held' }), battle({ outcome: 'sc-assisted' }),
    ];

    expect(pitBattleSummary(battles)).toBe('2 undercuts and 1 overcut worked; 1 held; 1 under a Safety Car or VSC');
  });
});
