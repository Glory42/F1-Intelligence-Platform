import { describe, expect, it } from 'vitest';
import { degradationCharts, degradationTable, shortTeamName } from '@/features/races/tyreDegradation';
import { getTeamColor } from '@/lib/f1/teamColors';
import type { Team, TyreDegradation } from '@/types';

const team = (id: number, teamKey: string, name: string): Team => ({ id, seasonId: 1, teamKey, name, nationality: null });
const ferrari = team(1, 'ferrari', 'Ferrari');
const redBull = team(2, 'red_bull_racing', 'Red Bull Racing');

const row = (t: Team, compound: string, msPerLap: number, laps = 20): TyreDegradation => ({
  team: t, compound, msPerLap, laps, stints: 2,
  points: [{ tyreAge: 2, lossMs: 2 * msPerLap }, { tyreAge: 5, lossMs: 5 * msPerLap }],
});

describe('degradationCharts', () => {
  it('draws one chart per compound in the order served, one line per team in seconds lost', () => {
    const charts = degradationCharts([row(ferrari, 'SOFT', 120), row(redBull, 'SOFT', 90), row(ferrari, 'HARD', 70)]);

    expect(charts.map((c) => c.compound)).toEqual(['SOFT', 'HARD']);
    expect(charts[0].series).toEqual([
      { id: 1, label: 'Ferrari', color: getTeamColor('ferrari'), points: [{ x: 2, y: 0.24 }, { x: 5, y: 0.6 }] },
      { id: 2, label: 'Red Bull', color: getTeamColor('red_bull_racing'), points: [{ x: 2, y: 0.18 }, { x: 5, y: 0.45 }] },
    ]);
  });
});

describe('degradationTable', () => {
  it('lists each team once with a cell per compound, gentlest on its tyres first', () => {
    const table = degradationTable([row(ferrari, 'SOFT', 120, 30), row(redBull, 'SOFT', 90), row(ferrari, 'HARD', 70)]);

    expect(table.compounds).toEqual(['SOFT', 'HARD']);
    expect(table.rows.map((r) => [r.team.name, r.cells.map((c) => c && [c.msPerLap, c.laps])])).toEqual([
      ['Red Bull Racing', [[90, 20], null]],
      ['Ferrari', [[120, 30], [70, 20]]],
    ]);
  });
});

describe('shortTeamName', () => {
  it('drops the suffixes that only make chart labels longer', () => {
    expect(shortTeamName('Red Bull Racing')).toBe('Red Bull');
    expect(shortTeamName('Haas F1 Team')).toBe('Haas');
    expect(shortTeamName('Racing Bulls')).toBe('Racing Bulls');
  });
});
