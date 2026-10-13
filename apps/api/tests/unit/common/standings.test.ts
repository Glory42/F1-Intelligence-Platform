import { describe, expect, test } from 'bun:test';
import { sortByChampionshipStanding, buildStandings, buildCareerStats } from '../../../src/common/standings';

type Entity = { id: number; name: string };
type StatsRow = { entityId: number; points: string; position: number | null };
type Stats = { championshipPosition: number | null; championshipPoints: string };
type Out = { name: string; stats: Stats };

const toStats = (row: StatsRow): Stats => ({ championshipPosition: row.position, championshipPoints: row.points });
const emptyStats: Stats = { championshipPosition: null, championshipPoints: '0' };
const toOutput = (entity: Entity, stats: Stats): Out => ({ name: entity.name, stats });

const adapter = {
  entityId: (e: Entity) => e.id,
  statsEntityId: (s: StatsRow) => s.entityId,
  toStats,
  emptyStats,
};

type Standing = { stats: { championshipPosition: number | null; championshipPoints: string } };

describe('sortByChampionshipStanding', () => {
  test('orders by championship position ascending', () => {
    const a: Standing = { stats: { championshipPosition: 2, championshipPoints: '100' } };
    const b: Standing = { stats: { championshipPosition: 1, championshipPoints: '50' } };
    expect(sortByChampionshipStanding(a, b)).toBeGreaterThan(0);
  });

  test('missing position (null) sorts after a ranked entry', () => {
    const a: Standing = { stats: { championshipPosition: null, championshipPoints: '999' } };
    const b: Standing = { stats: { championshipPosition: 1, championshipPoints: '1' } };
    expect(sortByChampionshipStanding(a, b)).toBeGreaterThan(0);
  });

  test('falls back to championship points (GP + sprint) when both positions are null', () => {
    const a: Standing = { stats: { championshipPosition: null, championshipPoints: '10' } };
    const b: Standing = { stats: { championshipPosition: null, championshipPoints: '20' } };
    expect(sortByChampionshipStanding(a, b)).toBeGreaterThan(0);
  });
});

describe('buildStandings', () => {
  const entities: Entity[] = [
    { id: 1, name: 'Alpha' },
    { id: 2, name: 'Beta' },
  ];

  test('merges matching stats rows onto each entity', () => {
    const statsRows: StatsRow[] = [
      { entityId: 1, points: '150', position: 2 },
      { entityId: 2, points: '200', position: 1 },
    ];
    const result = buildStandings(entities, statsRows, adapter, toOutput);
    expect(result.map((r) => r.name)).toEqual(['Beta', 'Alpha']);
  });

  test('entities with no matching stats row get emptyStats', () => {
    const result = buildStandings(entities, [], adapter, toOutput);
    expect(result.every((r) => r.stats === emptyStats)).toBe(true);
  });
});

describe('buildCareerStats', () => {
  test('preserves entry order and does not sort', () => {
    const entries: Entity[] = [
      { id: 1, name: 'Year 2023' },
      { id: 2, name: 'Year 2024' },
    ];
    const statsRows: StatsRow[] = [{ entityId: 2, points: '50', position: 5 }];
    const result = buildCareerStats(entries, statsRows, adapter, (e, stats) => ({ name: e.name, stats }));
    expect(result.map((r) => r.name)).toEqual(['Year 2023', 'Year 2024']);
  });

  test('missing stats row maps to null', () => {
    const entries: Entity[] = [{ id: 1, name: 'Year 2023' }];
    const result = buildCareerStats(entries, [], adapter, (e, stats) => ({ name: e.name, stats }));
    expect(result[0].stats).toBeNull();
  });
});
