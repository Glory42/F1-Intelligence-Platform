import { describe, expect, it } from 'bun:test';
import {
  findPitBattles, neutralisedLaps, type BattleTrace, type NeutralisationMessage,
} from '../../../../src/modules/strategy/pit-battles.helpers';

// Per-lap arrays (index 0 = lap 1) for cars A and B side by side over 25 laps. A positive gap means
// A runs behind B by that much; it switches from gapBefore to gapAfter on `changeLap`.
function pair(opts: { gapBefore: number; gapAfter: number; changeLap?: number; lapped?: boolean }) {
  const { gapBefore, gapAfter, changeLap = 19, lapped = false } = opts;
  const a: BattleTrace = { driverId: 1, positions: [], gapsMs: [], intervalsMs: [] };
  const b: BattleTrace = { driverId: 2, positions: [], gapsMs: [], intervalsMs: [] };
  for (let lap = 1; lap <= 25; lap++) {
    const gap = lap >= changeLap ? gapAfter : gapBefore;
    const [behind, ahead] = gap > 0 ? [a, b] : [b, a];
    behind.positions.push(6);
    ahead.positions.push(5);
    behind.gapsMs.push(10_000 + Math.abs(gap));
    ahead.gapsMs.push(10_000);
    behind.intervalsMs.push(Math.abs(gap));
    ahead.intervalsMs.push(2_000);
  }
  if (lapped) a.gapsMs = a.gapsMs.map(() => null);
  return [a, b];
}

const stops = (aLap: number, bLap: number) => [
  { driverId: 1, lapNumber: aLap },
  { driverId: 2, lapNumber: bLap },
];

describe('findPitBattles', () => {
  it('credits an undercut when the first car to stop comes out ahead', () => {
    const traces = pair({ gapBefore: 1_400, gapAfter: -2_100 });

    expect(findPitBattles(traces, stops(15, 18), new Set())).toEqual([{
      attackerId: 1, defenderId: 2, attackerLap: 15, defenderLap: 18,
      gapBeforeMs: 1_400, gapAfterMs: -2_100, outcome: 'undercut',
    }]);
  });

  it('calls it held when the car behind stops first and stays behind', () => {
    const traces = pair({ gapBefore: 1_400, gapAfter: 900 });

    expect(findPitBattles(traces, stops(15, 18), new Set())[0]).toMatchObject({ gapAfterMs: 900, outcome: 'held' });
  });

  it('credits an overcut when the car ahead stops first and comes out behind', () => {
    const traces = pair({ gapBefore: -1_000, gapAfter: 1_500 });

    expect(findPitBattles(traces, stops(15, 18), new Set())[0]).toMatchObject({ gapBeforeMs: -1_000, outcome: 'overcut' });
  });

  it('flags a swap with a Safety Car or VSC between the stops as SC-assisted, not strategy', () => {
    const traces = pair({ gapBefore: 1_400, gapAfter: -2_100 });

    expect(findPitBattles(traces, stops(15, 18), new Set([17]))[0].outcome).toBe('sc-assisted');
  });

  it('ignores cars more than 3 s apart, stops more than 5 laps apart and same-lap stops', () => {
    expect(findPitBattles(pair({ gapBefore: 3_200, gapAfter: -500 }), stops(15, 18), new Set())).toEqual([]);
    expect(findPitBattles(pair({ gapBefore: 1_000, gapAfter: -500, changeLap: 22 }), stops(15, 21), new Set())).toEqual([]);
    expect(findPitBattles(pair({ gapBefore: 1_000, gapAfter: 500 }), stops(15, 15), new Set())).toEqual([]);
  });

  it('ignores cars that were not running next to each other', () => {
    const [a, b] = pair({ gapBefore: 1_000, gapAfter: 500 });
    a.positions = a.positions.map(() => 8);

    expect(findPitBattles([a, b], stops(15, 18), new Set())).toEqual([]);
  });

  it('keeps the order but drops the gap when a car is lapped afterwards', () => {
    const [a, b] = pair({ gapBefore: 1_000, gapAfter: 5_000, lapped: true });
    a.positions[18] = 9;

    expect(findPitBattles([a, b], stops(15, 18), new Set())[0]).toMatchObject({ gapBeforeMs: 1_000, gapAfterMs: null, outcome: 'held' });
  });

  it('skips a pair when either car is gone by the lap after the second stop', () => {
    const [a, b] = pair({ gapBefore: 1_000, gapAfter: 500 });
    b.positions = b.positions.slice(0, 18);

    expect(findPitBattles([a, b], stops(15, 18), new Set())).toEqual([]);
  });
});

describe('neutralisedLaps', () => {
  const msg = (lapNumber: number, message: string, flag: string | null = null): NeutralisationMessage => ({
    lapNumber, message, flag, category: flag ? 'Flag' : 'SafetyCar',
  });

  it('covers Safety Car and VSC periods from deployment to the end call, and red-flag laps', () => {
    const laps = neutralisedLaps([
      msg(10, 'SAFETY CAR DEPLOYED'),
      msg(12, 'SAFETY CAR IN THIS LAP'),
      msg(30, 'VSC DEPLOYED'),
      msg(31, 'VSC ENDING'),
      msg(40, 'RED FLAG', 'RED'),
    ]);

    expect([...laps].sort((x, y) => x - y)).toEqual([10, 11, 12, 30, 31, 40]);
  });

  it('runs an unclosed period to the last lap it can know of', () => {
    expect([...neutralisedLaps([msg(50, 'VIRTUAL SAFETY CAR DEPLOYED')], 52)]).toEqual([50, 51, 52]);
  });
});
