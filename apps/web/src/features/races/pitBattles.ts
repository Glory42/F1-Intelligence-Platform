import type { PitBattle } from '@/types';

export interface PitBattleLine {
  subjectId: number;
  objectId: number;
  verb: 'undercut' | 'overcut' | 'failed to undercut' | 'covered' | 'pitted before';
  tone: 'gain' | 'neutral' | 'neutralised';
  laps: string;
  gaps: string;
}

// Positive = the car named first is behind. A null gap means one of them was lapped.
export function formatBattleGap(ms: number | null): string {
  if (ms == null) return 'lapped';
  if (ms === 0) return 'level';
  return `${(Math.abs(ms) / 1000).toFixed(1)} s ${ms > 0 ? 'behind' : 'ahead'}`;
}

const negate = (ms: number | null) => (ms == null ? null : -ms);

// Each line is told from the side of the car that gained, or of the first to stop when nobody did.
export function pitBattleLine(b: PitBattle): PitBattleLine {
  const fromDefender = b.outcome === 'overcut';
  const [subjectId, objectId] = fromDefender ? [b.defenderId, b.attackerId] : [b.attackerId, b.defenderId];
  const [subjectLap, objectLap] = fromDefender ? [b.defenderLap, b.attackerLap] : [b.attackerLap, b.defenderLap];
  const [before, after] = fromDefender ? [negate(b.gapBeforeMs), negate(b.gapAfterMs)] : [b.gapBeforeMs, b.gapAfterMs];

  const verb: PitBattleLine['verb'] =
    b.outcome === 'undercut' || b.outcome === 'overcut' ? b.outcome
      : b.outcome === 'sc-assisted' ? 'pitted before'
        : b.gapBeforeMs > 0 ? 'failed to undercut' : 'covered';
  const tone: PitBattleLine['tone'] =
    b.outcome === 'sc-assisted' ? 'neutralised' : b.outcome === 'held' ? 'neutral' : 'gain';

  return {
    subjectId, objectId, verb, tone,
    laps: `pitted lap ${subjectLap} vs ${objectLap}`,
    gaps: `${formatBattleGap(before)} → ${formatBattleGap(after)}`,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function pitBattleSummary(battles: PitBattle[]): string {
  const count = (outcome: PitBattle['outcome']) => battles.filter((b) => b.outcome === outcome).length;
  const [undercuts, overcuts, held, neutralised] = [count('undercut'), count('overcut'), count('held'), count('sc-assisted')];
  const parts = [
    undercuts + overcuts > 0 ? `${[undercuts && plural(undercuts, 'undercut'), overcuts && plural(overcuts, 'overcut')].filter(Boolean).join(' and ')} worked` : null,
    held > 0 ? `${held} held` : null,
    neutralised > 0 ? `${neutralised} under a Safety Car or VSC` : null,
  ];
  return parts.filter(Boolean).join('; ');
}
