import { describe, expect, test } from 'vitest';
import { aggregateCareerStats } from '../../../../src/features/compare/compareStats';

type Stats = {
  wins: number;
  podiums: number;
  championshipPoints: string;
  dnfCount: number;
  championshipPosition: number | null;
};

const year = (stats: Stats | null) => ({ stats });

describe('aggregateCareerStats', () => {
  test('returns null when career is null', () => {
    expect(aggregateCareerStats(null, () => 0)).toBeNull();
  });

  test('sums wins, podiums, points, and dnfs across years', () => {
    const career = [
      year({ wins: 2, podiums: 5, championshipPoints: '150.5', dnfCount: 1, championshipPosition: 4 }),
      year({ wins: 1, podiums: 3, championshipPoints: '90', dnfCount: 2, championshipPosition: 6 }),
    ];
    const result = aggregateCareerStats(career, () => 0);
    expect(result).toEqual(expect.objectContaining({ wins: 3, podiums: 8, points: 240.5, dnfs: 3 }));
  });

  test('skips years with null stats', () => {
    const career = [year({ wins: 1, podiums: 1, championshipPoints: '25', dnfCount: 0, championshipPosition: 1 }), year(null)];
    const result = aggregateCareerStats(career, () => 0);
    expect(result?.wins).toBe(1);
  });

  test('bestFin tracks the minimum championship position seen', () => {
    const career = [
      year({ wins: 0, podiums: 0, championshipPoints: '0', dnfCount: 0, championshipPosition: 5 }),
      year({ wins: 0, podiums: 0, championshipPoints: '0', dnfCount: 0, championshipPosition: 2 }),
      year({ wins: 0, podiums: 0, championshipPoints: '0', dnfCount: 0, championshipPosition: null }),
    ];
    const result = aggregateCareerStats(career, () => 0);
    expect(result?.bestFin).toBe(2);
  });

  test('uses getEntries and getPoles to extract entity-specific fields', () => {
    const career = [year({ wins: 0, podiums: 0, championshipPoints: '0', dnfCount: 0, championshipPosition: null })];
    const result = aggregateCareerStats(
      career,
      () => 22,
      () => 3
    );
    expect(result).toEqual(expect.objectContaining({ entries: 22, poles: 3 }));
  });
});
