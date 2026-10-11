import { describe, expect, test } from 'bun:test';
import { buildChases, buildCoreLinks, groupLineages, nearestMonthDay, type LineageRow } from '../../../../src/modules/history/history.helpers';
import type { RecordEntry } from '../../../../src/common/types';

const entry = (f1dbId: string, value: number, coreId: number | null = null): RecordEntry => ({
  f1dbId, name: f1dbId, value, nationality: null, coreId, active: coreId != null,
});

describe('nearestMonthDay', () => {
  test('returns the requested day when it has races', () => {
    expect(nearestMonthDay('10-11', ['10-11', '10-12'])).toBe('10-11');
  });

  test('picks the closest day either side', () => {
    expect(nearestMonthDay('12-25', ['12-13', '11-30'])).toBe('12-13');
  });

  test('wraps round New Year', () => {
    expect(nearestMonthDay('12-30', ['01-02', '12-20'])).toBe('01-02');
  });

  test('breaks a tie towards the later date', () => {
    expect(nearestMonthDay('06-15', ['06-13', '06-17'])).toBe('06-17');
  });

  test('returns null when no day has races', () => {
    expect(nearestMonthDay('06-15', [])).toBeNull();
  });
});

describe('buildCoreLinks', () => {
  const driver = (id: number, firstName: string, lastName: string, year: number) => ({ id, firstName, lastName, year });
  const team = (id: number, teamKey: string, year: number) => ({ id, teamKey, year });

  test("links each driver to their latest season and flags only the current grid as active", () => {
    const { drivers } = buildCoreLinks(
      [driver(5, 'Lewis', 'Hamilton', 2026), driver(1, 'Lewis', 'Hamilton', 2007), driver(2, 'Ayrton', 'Senna', 1994)],
      [],
    );
    expect(drivers.get('lewis hamilton')).toEqual({ id: 5, active: true });
    expect(drivers.get('ayrton senna')).toEqual({ id: 2, active: false });
  });

  test('links a former constructor through its longest-running core key', () => {
    const { teams } = buildCoreLinks(
      [driver(1, 'Max', 'Verstappen', 2026)],
      [team(10, 'team_lotus', 1993), team(11, 'team_lotus', 1994), team(12, 'lotus', 2011)],
    );
    expect(teams.get('lotus')).toEqual({ id: 11, teamKey: 'team_lotus', active: false });
  });

  test('prefers the key on the current grid when a constructor was renamed', () => {
    const { teams } = buildCoreLinks(
      [driver(1, 'Max', 'Verstappen', 2026)],
      [team(1, 'red_bull', 2016), team(2, 'red_bull', 2017), team(3, 'red_bull_racing', 2026)],
    );
    expect(teams.get('red-bull')).toEqual({ id: 3, teamKey: 'red_bull_racing', active: true });
  });
});

describe('buildChases', () => {
  const leaders = {
    wins: [entry('hamilton', 106, 1), entry('schumacher', 91)],
    championships: [entry('hamilton', 7, 1)],
    poles: [],
    podiums: [entry('hamilton', 208, 1)],
    starts: [entry('alonso', 442, 3)],
  };
  const active = [
    { f1dbId: 'hamilton', name: 'hamilton', nationality: null, coreId: 1, active: true, totals: { wins: 106, championships: 7, poles: 104, podiums: 208, starts: 396 } },
    { f1dbId: 'verstappen', name: 'verstappen', nationality: null, coreId: 2, active: true, totals: { wins: 72, championships: 4, poles: 49, podiums: 0, starts: 249 } },
    { f1dbId: 'alonso', name: 'alonso', nationality: null, coreId: 3, active: true, totals: { wins: 32, championships: 2, poles: 22, podiums: 106, starts: 442 } },
  ];

  test('pairs each record with the best active driver who does not hold it', () => {
    const chases = buildChases(leaders, active);
    expect(chases.find((c) => c.stat === 'wins')?.chaser).toEqual({
      f1dbId: 'verstappen', name: 'verstappen', nationality: null, coreId: 2, active: true, value: 72,
    });
    expect(chases.find((c) => c.stat === 'starts')?.chaser?.f1dbId).toBe('hamilton');
  });

  test('skips stats with no leaders and leaves the chaser empty when nobody active has scored', () => {
    const chases = buildChases(leaders, active.filter((d) => d.f1dbId !== 'alonso'));
    expect(chases.map((c) => c.stat)).not.toContain('poles');
    expect(chases.find((c) => c.stat === 'podiums')?.chaser).toBeNull();
  });
});

describe('groupLineages', () => {
  const row = (parent: string, position: number, id: string, yearFrom: number, yearTo: number | null): LineageRow => ({
    parentF1dbId: parent, position, constructorF1dbId: id, yearFrom, yearTo, name: id.toUpperCase(), raceWins: 1, championships: 0,
  });
  const mercedesChain = (parent: string) => [
    row(parent, 1, 'tyrrell', 1970, 1998), row(parent, 2, 'bar', 1999, 2005), row(parent, 3, 'mercedes', 2010, null),
  ];

  test('collapses the copies F1DB stores under each member into one family keyed by its latest name', () => {
    const lineages = groupLineages([...mercedesChain('mercedes'), ...mercedesChain('tyrrell')], new Map());
    expect(lineages).toHaveLength(1);
    expect(lineages[0].f1dbId).toBe('mercedes');
    expect(lineages[0].members.map((m) => m.f1dbId)).toEqual(['tyrrell', 'bar', 'mercedes']);
  });

  test('drops single-name chronologies and lists active families first', () => {
    const lineages = groupLineages([
      row('manor', 1, 'virgin', 2010, 2011), row('manor', 2, 'manor', 2016, 2016),
      row('ferrari', 1, 'ferrari', 1950, null),
      ...mercedesChain('mercedes'),
    ], new Map([
      ['mercedes', { id: 11, teamKey: 'mercedes', active: true }],
      ['manor', { id: 7, teamKey: 'manor', active: false }],
    ]));
    expect(lineages.map((l) => [l.f1dbId, l.coreTeam?.id ?? null, l.active])).toEqual([['mercedes', 11, true], ['manor', 7, false]]);
  });

  test('links every member that has a core team page', () => {
    const [family] = groupLineages(mercedesChain('mercedes'), new Map([['tyrrell', { id: 3, teamKey: 'tyrrell', active: false }]]));
    expect(family.members.map((m) => m.coreId)).toEqual([3, null, null]);
  });
});
