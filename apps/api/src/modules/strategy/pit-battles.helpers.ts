import type { PitBattle } from '../../common/types';

export interface BattleTrace {
  driverId: number;
  positions: number[];
  gapsMs: Array<number | null>;
  intervalsMs: Array<number | null>;
}

export interface BattleStop {
  driverId: number;
  lapNumber: number;
}

export interface NeutralisationMessage {
  lapNumber: number | null;
  category: string;
  flag: string | null;
  message: string;
}

type PitBattleOutcome = PitBattle['outcome'];

const MAX_GAP_MS = 3_000;
const MAX_LAPS_BETWEEN_STOPS = 5;

const SC_START = /^SAFETY CAR DEPLOYED/;
const SC_END = /^SAFETY CAR IN THIS LAP/;
const VSC_START = /^(VIRTUAL SAFETY CAR|VSC) DEPLOYED/;
const VSC_END = /^(VIRTUAL SAFETY CAR|VSC) ENDING/;

// Laps run at least partly behind a Safety Car or VSC, or under a red flag. Messages in time order.
export function neutralisedLaps(messages: NeutralisationMessage[], lastLap?: number): Set<number> {
  const laps = new Set<number>();
  const open = new Map<'SC' | 'VSC', number>();
  const close = (kind: 'SC' | 'VSC', end: number) => {
    const start = open.get(kind);
    if (start == null) return;
    for (let lap = start; lap <= end; lap++) laps.add(lap);
    open.delete(kind);
  };

  for (const m of messages) {
    if (m.lapNumber == null) continue;
    const text = m.message.toUpperCase();
    if (m.flag === 'RED') laps.add(m.lapNumber);
    else if (VSC_START.test(text)) open.set('VSC', m.lapNumber);
    else if (VSC_END.test(text)) close('VSC', m.lapNumber);
    else if (SC_START.test(text)) open.set('SC', m.lapNumber);
    else if (SC_END.test(text)) close('SC', m.lapNumber);
  }
  for (const [kind, start] of open) close(kind, Math.max(start, lastLap ?? start));
  return laps;
}

// A's time behind B at the end of `lap` (negative = A ahead), or null gap when a lapped car has none.
function standingOn(a: BattleTrace, b: BattleTrace, lap: number): { aBehind: boolean; adjacent: boolean; gapMs: number | null } | null {
  const i = lap - 1;
  const [pa, pb] = [a.positions[i], b.positions[i]];
  if (pa == null || pb == null) return null;
  const aBehind = pa > pb;
  const adjacent = Math.abs(pa - pb) === 1;
  const interval = adjacent ? (aBehind ? a : b).intervalsMs[i] : null;
  if (interval != null) return { aBehind, adjacent, gapMs: aBehind ? interval : -interval };
  const [ga, gb] = [a.gapsMs[i], b.gapsMs[i]];
  return { aBehind, adjacent, gapMs: ga != null && gb != null ? ga - gb : null };
}

function outcomeOf(behindBefore: boolean, behindAfter: boolean): PitBattleOutcome {
  if (behindBefore && !behindAfter) return 'undercut';
  if (!behindBefore && behindAfter) return 'overcut';
  return 'held';
}

// Two cars running nose to tail that stop a few laps apart: whoever stops first is the attacker.
// Compared on the lap before the first stop and the lap after the second (its out-lap).
export function findPitBattles(traces: BattleTrace[], stops: BattleStop[], neutralised: Set<number>): PitBattle[] {
  const traceOf = new Map(traces.map((t) => [t.driverId, t]));
  const lapsOf = (driverId: number) => stops.filter((s) => s.driverId === driverId).map((s) => s.lapNumber);
  const battles: PitBattle[] = [];

  for (const first of stops) {
    const attacker = traceOf.get(first.driverId);
    if (!attacker || first.lapNumber < 2) continue;
    for (const second of stops) {
      const gapLaps = second.lapNumber - first.lapNumber;
      if (second.driverId === first.driverId || gapLaps <= 0 || gapLaps > MAX_LAPS_BETWEEN_STOPS) continue;
      const defender = traceOf.get(second.driverId);
      if (!defender) continue;
      const window = (lap: number) => lap > first.lapNumber && lap <= second.lapNumber + 1;
      // Another stop by either car inside the window would confound the comparison.
      if (lapsOf(attacker.driverId).some(window) || lapsOf(defender.driverId).some((l) => window(l) && l !== second.lapNumber)) continue;

      const before = standingOn(attacker, defender, first.lapNumber - 1);
      if (!before?.adjacent || before.gapMs == null || Math.abs(before.gapMs) > MAX_GAP_MS) continue;
      const after = standingOn(attacker, defender, second.lapNumber + 1);
      if (!after) continue;

      let underNeutralisation = false;
      for (let lap = first.lapNumber; lap <= second.lapNumber + 1; lap++) underNeutralisation ||= neutralised.has(lap);
      battles.push({
        attackerId: attacker.driverId, defenderId: defender.driverId,
        attackerLap: first.lapNumber, defenderLap: second.lapNumber,
        gapBeforeMs: before.gapMs, gapAfterMs: after.gapMs,
        outcome: underNeutralisation ? 'sc-assisted' : outcomeOf(before.aBehind, after.aBehind),
      });
    }
  }
  return battles.sort((x, y) => x.attackerLap - y.attackerLap || x.defenderLap - y.defenderLap);
}
