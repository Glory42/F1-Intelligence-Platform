import { describe, expect, it } from 'bun:test';
import {
  FUEL_EFFECT_MS_PER_LAP, teamDegradation, type DegradationLap,
} from '../../../../src/modules/strategy/degradation.helpers';

const TOTAL_LAPS = 50;
const WEAR_MS_PER_LAP = 80;

// Raw laps of one set: tyre age 1.. from `firstLap`, losing WEAR_MS_PER_LAP to wear and gaining
// FUEL_EFFECT_MS_PER_LAP as fuel burns, so the raw times only slow by 25 ms a lap.
function stint(
  firstLap: number, ages: number, opts: { teamId?: number; driverId?: number; compound?: string; baseMs?: number } = {},
): DegradationLap[] {
  const { teamId = 1, driverId = 10, compound = 'MEDIUM', baseMs = 90_000 } = opts;
  return Array.from({ length: ages }, (_, i) => {
    const lapNumber = firstLap + i;
    const tyreLife = i + 1;
    const fuelMs = FUEL_EFFECT_MS_PER_LAP * (TOTAL_LAPS - lapNumber);
    return { teamId, driverId, lapNumber, compound, tyreLife, lapTimeMs: baseMs + WEAR_MS_PER_LAP * tyreLife + fuelMs };
  });
}

describe('teamDegradation', () => {
  it('measures wear after taking out the fuel burned, not the raw slope', () => {
    const [row] = teamDegradation(stint(10, 10), TOTAL_LAPS);

    expect(FUEL_EFFECT_MS_PER_LAP).toBe(55);
    expect(row).toMatchObject({ teamId: 1, compound: 'MEDIUM', msPerLap: 80, laps: 10, stints: 1 });
  });

  it('drops laps over 107% of the stint median as traffic or mistakes', () => {
    const laps = stint(10, 10);
    laps.push({ ...laps[9], lapNumber: 20, tyreLife: 11, lapTimeMs: Math.round(laps[9].lapTimeMs! * 1.1) });

    expect(teamDegradation(laps, TOTAL_LAPS)[0]).toMatchObject({ msPerLap: 80, laps: 10 });
  });

  it('fits each set on its own baseline, so a slower second stint does not read as wear', () => {
    const laps = [...stint(2, 10), ...stint(30, 10, { baseMs: 91_000 })];

    expect(teamDegradation(laps, TOTAL_LAPS)[0]).toMatchObject({ msPerLap: 80, laps: 20, stints: 2 });
  });

  it('pools both drivers of a team into one row per compound', () => {
    const laps = [...stint(5, 8, { driverId: 10 }), ...stint(5, 8, { driverId: 11, baseMs: 90_300 })];

    const rows = teamDegradation(laps, TOTAL_LAPS);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ msPerLap: 80, laps: 16, stints: 2 });
  });

  it('leaves out stints under 5 clean laps and teams under 10 on a compound', () => {
    const laps = [...stint(2, 4, { compound: 'SOFT' }), ...stint(10, 9, { compound: 'HARD' })];

    expect(teamDegradation(laps, TOTAL_LAPS)).toEqual([]);
  });

  it('ignores wet-weather tyres and laps missing a time, compound or tyre age', () => {
    const laps = [
      ...stint(5, 10, { compound: 'INTERMEDIATE' }),
      ...stint(20, 10).map((l, i) => (i % 2 === 0 ? { ...l, lapTimeMs: null } : i % 3 === 0 ? { ...l, tyreLife: null } : l)),
    ];

    expect(teamDegradation(laps, TOTAL_LAPS)).toEqual([]);
  });

  it('charts the time lost to a new set in 3-lap buckets of tyre age', () => {
    const [row] = teamDegradation(stint(10, 10), TOTAL_LAPS);

    expect(row.points).toEqual([
      { tyreAge: 2, lossMs: 160 },
      { tyreAge: 5, lossMs: 400 },
      { tyreAge: 8, lossMs: 640 },
      { tyreAge: 10, lossMs: 800 },
    ]);
  });

  it('orders compounds softest first, then the gentlest team on each', () => {
    const laps = [
      ...stint(2, 10, { teamId: 1, compound: 'HARD' }),
      ...stint(2, 10, { teamId: 1, driverId: 11, compound: 'SOFT' }),
      ...stint(2, 10, { teamId: 2, driverId: 20, compound: 'SOFT', baseMs: 89_000 }).map((l) => ({
        ...l, lapTimeMs: l.lapTimeMs! - 30 * l.tyreLife!,
      })),
    ];

    expect(teamDegradation(laps, TOTAL_LAPS).map((r) => [r.compound, r.teamId, r.msPerLap])).toEqual([
      ['SOFT', 2, 50], ['SOFT', 1, 80], ['HARD', 1, 80],
    ]);
  });
});
