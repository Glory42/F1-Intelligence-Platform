import { describe, expect, it } from 'vitest';
import { driverStopSummaries } from '@/features/teams/pitStopSummary';
import { mergeTeamHistory } from '@/features/teams/teamHistory';

const driver = (id: number, code: string) => ({ id, code });
const stop = (d: ReturnType<typeof driver>, stationaryMs: number) => ({ driver: d, stationaryMs });

describe('driverStopSummaries', () => {
  it("gives each driver's stop count, median and best, fastest median first", () => {
    const ham = driver(1, 'HAM');
    const lec = driver(2, 'LEC');
    const summaries = driverStopSummaries([
      stop(ham, 2600), stop(lec, 2200), stop(ham, 2400), stop(lec, 2400), stop(ham, 9100),
    ]);

    expect(summaries.map((s) => [s.driver.code, s.stops, s.medianMs, s.bestMs])).toEqual([
      ['LEC', 2, 2300, 2200],
      ['HAM', 3, 2600, 2400],
    ]);
  });
});

describe('mergeTeamHistory', () => {
  it('joins our seasons with the F1DB chassis and power unit, newest first, keeping years only one side has', () => {
    const rows = mergeTeamHistory(
      [{ year: 2025, teamId: 7, stats: null }, { year: 2026, teamId: 9, stats: null }],
      [{ year: 2026, chassis: 'SF-26', engine: 'Ferrari' }, { year: 1979, chassis: '312T4', engine: 'Ferrari' }],
    );

    expect(rows.map((r) => [r.year, r.teamId, r.chassis, r.engine])).toEqual([
      [2026, 9, 'SF-26', 'Ferrari'],
      [2025, 7, null, null],
      [1979, null, '312T4', 'Ferrari'],
    ]);
  });
});
