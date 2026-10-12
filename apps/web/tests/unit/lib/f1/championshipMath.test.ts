import { describe, expect, it } from 'vitest';
import { formatTitleOdds, remainingSessions, titleContention } from '@/lib/f1/championshipMath';

// 2021, before Abu Dhabi: VER and HAM level on 369.5 with one GP (25 + fastest-lap point) left.
const ABU_DHABI_2021 = [
  { id: 33, points: 369.5 },
  { id: 44, points: 369.5 },
  { id: 77, points: 218 },
];

describe('titleContention', () => {
  it('keeps every driver within reach of the leader in contention and eliminates the rest', () => {
    const result = titleContention(ABU_DHABI_2021, { year: 2021, grandsPrix: 1, sprints: 0 });

    expect(result.get(33)).toEqual({ alive: true, maxPoints: 395.5, gapToLeader: 0 });
    expect(result.get(44)).toEqual({ alive: true, maxPoints: 395.5, gapToLeader: 0 });
    expect(result.get(77)).toEqual({ alive: false, maxPoints: 244, gapToLeader: 151.5 });
  });

  it('adds the points still available from remaining sprints (8 a win since 2022, 3 in 2021)', () => {
    const standings = [{ id: 1, points: 300 }, { id: 2, points: 242 }];

    expect(titleContention(standings, { year: 2025, grandsPrix: 2, sprints: 1 }).get(2)?.maxPoints).toBe(300);
    expect(titleContention(standings, { year: 2021, grandsPrix: 2, sprints: 1 }).get(2)?.maxPoints).toBe(297);
  });
});

describe('remainingSessions', () => {
  it('counts unfinished grands prix and the sprints not yet run on sprint weekends', () => {
    const races = [
      { status: 'completed', hasSprint: true },
      { status: 'sprint_done', hasSprint: true },
      { status: 'sprint_qualifying_done', hasSprint: true },
      { status: 'scheduled', hasSprint: false },
      { status: 'qualifying_done', hasSprint: false },
    ];

    expect(remainingSessions(races)).toEqual({ grandsPrix: 4, sprints: 1 });
  });
});

describe('formatTitleOdds', () => {
  it('rounds to whole percents, flags tiny non-zero odds and caps near-certainty at 100%', () => {
    expect([0.4213, 0.004, 0, 0.9971].map(formatTitleOdds)).toEqual(['42%', '<1%', '0%', '100%']);
  });
});
