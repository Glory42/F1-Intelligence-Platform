import { describe, expect, it } from 'vitest';
import {
  applyScenario, clinchOutlook, clinchSentence, rankWithCountback, remainingWeekends, scenarioOutcome, titleRaceSentence,
  weekendMaxPoints,
  type Contender, type Weekend,
} from '@/features/standings/titleScenario';

const gp = (round: number, name = `Round ${round} Grand Prix`): Weekend => ({ round, name, grandPrix: true, sprint: false });
const contender = (id: number, name: string, points: number, finishes: number[] = []): Contender => ({ id, name, points, finishes });

describe('remainingWeekends', () => {
  it('keeps the unfinished rounds in order, with a sprint only while it is still to run', () => {
    const races = [
      { roundNumber: 21, name: 'Qatar Grand Prix', status: 'scheduled' as const, hasSprint: true },
      { roundNumber: 19, name: 'Mexico City Grand Prix', status: 'completed' as const, hasSprint: false },
      { roundNumber: 20, name: 'São Paulo Grand Prix', status: 'sprint_done' as const, hasSprint: true },
    ];

    expect(remainingWeekends(races)).toEqual([
      { round: 20, name: 'São Paulo Grand Prix', grandPrix: true, sprint: false },
      { round: 21, name: 'Qatar Grand Prix', grandPrix: true, sprint: true },
    ]);
  });
});

describe('weekendMaxPoints', () => {
  const sprintWeekend: Weekend = { round: 1, name: 'X', grandPrix: true, sprint: true };

  it("adds a win, the fastest-lap point while it existed and a sprint win for a driver", () => {
    expect(weekendMaxPoints(sprintWeekend, 2025, 'driver')).toBe(33);
    expect(weekendMaxPoints(sprintWeekend, 2024, 'driver')).toBe(34);
    expect(weekendMaxPoints(sprintWeekend, 2021, 'driver')).toBe(29);
  });

  it('counts a one-two for a team', () => {
    expect(weekendMaxPoints(sprintWeekend, 2025, 'team')).toBe(25 + 18 + 8 + 7);
    expect(weekendMaxPoints(gp(1), 2021, 'team')).toBe(25 + 18 + 1);
  });
});

describe('clinchOutlook', () => {
  it('gives the margin the leader needs over each rival to clinch at the next round', () => {
    const outlook = clinchOutlook(
      [contender(1, 'Verstappen', 400), contender(4, 'Norris', 380), contender(81, 'Piastri', 362)],
      [gp(21, 'Qatar Grand Prix'), gp(22, 'Abu Dhabi Grand Prix')],
      2025,
      'driver',
    );

    expect(outlook).toEqual({
      kind: 'next',
      leader: contender(1, 'Verstappen', 400),
      weekend: gp(21, 'Qatar Grand Prix'),
      margins: [{ rival: contender(4, 'Norris', 380), points: 6 }, { rival: contender(81, 'Piastri', 362), points: -12 }],
    });
  });

  it('names the earliest round the leader could clinch when the next is too soon', () => {
    const outlook = clinchOutlook([contender(1, 'A', 300), contender(2, 'B', 290)], [gp(20), gp(21), gp(22)], 2025, 'driver');

    expect(outlook).toMatchObject({ kind: 'later', weekend: gp(21) });
  });

  it('calls the title decided once no rival can reach the leader', () => {
    expect(clinchOutlook([contender(1, 'A', 300), contender(2, 'B', 249)], [gp(21), gp(22)], 2025, 'driver'))
      .toMatchObject({ kind: 'champion', leader: { id: 1 } });
  });

  it('leaves a rival who can only draw level in it, since countback could still decide', () => {
    expect(clinchOutlook([contender(1, 'A', 300), contender(2, 'B', 250)], [gp(21), gp(22)], 2025, 'driver'))
      .toMatchObject({ kind: 'next', margins: [{ rival: { id: 2 }, points: -24 }] });
  });

  it('has nothing to say once the season is over', () => {
    expect(clinchOutlook([contender(1, 'A', 300), contender(2, 'B', 290)], [], 2025, 'driver')).toBeNull();
  });
});

describe('clinchSentence', () => {
  it('reads out each rival, winning margins and allowed losses alike', () => {
    const outlook = clinchOutlook(
      [contender(1, 'Verstappen', 400), contender(4, 'Norris', 380), contender(81, 'Piastri', 362)],
      [gp(21, 'Qatar Grand Prix'), gp(22, 'Abu Dhabi Grand Prix')],
      2025,
      'driver',
    )!;

    expect(clinchSentence(outlook, 'driver')).toBe(
      'Verstappen clinches the title at the Qatar Grand Prix by outscoring Norris by 6 points or more and losing no more than 12 points to Piastri.',
    );
  });

  it("speaks of the constructors' title for teams, and of later rounds and settled titles", () => {
    const later = clinchOutlook([contender(1, 'McLaren', 600), contender(2, 'Ferrari', 560)], [gp(20), gp(21), gp(22)], 2025, 'team')!;
    const settled = clinchOutlook([contender(1, 'McLaren', 600), contender(2, 'Ferrari', 400)], [gp(22)], 2025, 'team')!;

    expect(clinchSentence(later, 'team')).toBe("The earliest McLaren can clinch the constructors' title is the Round 21 Grand Prix.");
    expect(clinchSentence(settled, 'team')).toBe("No one can catch McLaren any more: the constructors' title is decided.");
  });
});

describe('titleRaceSentence', () => {
  it("reads the season's races straight into the sentence, and says nothing once they are all run", () => {
    const races = [
      { roundNumber: 23, name: 'Qatar Grand Prix', status: 'scheduled' as const, hasSprint: false },
      { roundNumber: 24, name: 'Abu Dhabi Grand Prix', status: 'scheduled' as const, hasSprint: false },
    ];
    const contenders = [contender(1, 'Verstappen', 400), contender(4, 'Norris', 380)];

    expect(titleRaceSentence(contenders, races, 2025, 'driver')).toBe(
      'Verstappen clinches the title at the Qatar Grand Prix by outscoring Norris by 6 points or more.',
    );
    expect(titleRaceSentence(contenders, races.map((r) => ({ ...r, status: 'completed' as const })), 2025, 'driver')).toBeNull();
  });
});

describe('rankWithCountback', () => {
  it('breaks a points tie on wins, then second places, as the 2021 title would have been', () => {
    const ranked = rankWithCountback([
      contender(44, 'Hamilton', 369.5, [8, 5, 4]),
      contender(33, 'Verstappen', 369.5, [9, 8, 1]),
      contender(77, 'Bottas', 218, [1, 7, 3]),
    ]);

    expect(ranked.map((c) => c.id)).toEqual([33, 44, 77]);
    expect(rankWithCountback([contender(1, 'A', 10, [1, 0, 2]), contender(2, 'B', 10, [1, 1])]).map((c) => c.id)).toEqual([2, 1]);
  });
});

describe('applyScenario', () => {
  it('adds the picked finishes, sprint included, and re-ranks with countback from the grand prix places', () => {
    const weekends: Weekend[] = [{ round: 22, name: 'Abu Dhabi Grand Prix', grandPrix: true, sprint: true }];
    const result = applyScenario(
      [contender(44, 'Hamilton', 369.5, [8, 5]), contender(33, 'Verstappen', 369.5, [9, 8])],
      [
        { id: 44, round: 22, gp: 1, sprint: 2 },
        { id: 33, round: 22, gp: 2, sprint: 1 },
      ],
      weekends,
      2025,
    );

    expect(result.map((c) => [c.id, c.points, c.finishes.slice(0, 2)])).toEqual([
      [44, 369.5 + 25 + 7, [9, 5]],
      [33, 369.5 + 18 + 8, [9, 9]],
    ]);
  });

  it('ignores a sprint pick on a weekend without a sprint still to run', () => {
    const result = applyScenario([contender(1, 'A', 10)], [{ id: 1, round: 22, gp: null, sprint: 1 }], [gp(22)], 2025);

    expect(result[0].points).toBe(10);
  });
});

describe('scenarioOutcome', () => {
  const weekends = [gp(21, 'Qatar Grand Prix'), gp(22, 'Abu Dhabi Grand Prix')];

  it('names the round the picked results settle the title, counting every later pick in the final table', () => {
    const outcome = scenarioOutcome(
      [contender(1, 'VER', 400), contender(4, 'NOR', 380)],
      [{ id: 1, round: 21, gp: 1, sprint: null }, { id: 4, round: 22, gp: 1, sprint: null }],
      weekends, 2025,
    );

    expect(outcome).toMatchObject({ champion: { id: 1 }, decidedAt: { round: 21 }, onCountback: false });
    expect(outcome!.standings.map((c) => [c.id, c.points])).toEqual([[1, 425], [4, 405]]);
  });

  it('goes to countback when the final round leaves them level, a ninth win beating more second places', () => {
    const outcome = scenarioOutcome(
      [contender(4, 'NOR', 367, [8, 5]), contender(1, 'VER', 360, [8, 2])],
      [{ id: 1, round: 22, gp: 1, sprint: null }, { id: 4, round: 22, gp: 2, sprint: null }],
      [gp(22, 'Abu Dhabi Grand Prix')], 2025,
    );

    expect(outcome).toMatchObject({ champion: { id: 1, points: 385 }, decidedAt: { round: 22 }, onCountback: true });
  });

  it('has no outcome once the season is over', () => {
    expect(scenarioOutcome([contender(1, 'VER', 400)], [], [], 2025)).toBeNull();
  });
});
