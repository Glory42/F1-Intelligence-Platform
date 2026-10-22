import { describe, expect, test } from 'bun:test';
import {
  aggregateSeasonScores,
  buildIntelStandingRows,
  type SeasonFeatureRow,
  type SeasonTotals,
} from '../../../../src/modules/predictions/intel-standings.helpers';
import type { drivers, teams, driverPredictionFeatures } from '../../../../src/db/schema';
import { toDriver } from '../../../../src/common/mappers';
import { storedGpFeatures } from '../../../support/factories/driverPredictionFeatures.factory';

const team: typeof teams.$inferSelect = {
  id: 1, seasonId: 2025, teamKey: 'red_bull', name: 'Red Bull Racing', nationality: 'Austrian',
  createdAt: new Date('2025-01-01T00:00:00Z'),
};

function driver(id: number, code: string): typeof drivers.$inferSelect {
  return {
    id, seasonId: 2025, teamId: 1, driverNumber: id, code,
    firstName: code, lastName: `Last${id}`, nationality: 'Dutch', headshotUrl: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
  };
}

const mapped = (id: number, code: string) => toDriver(driver(id, code), team);

function featureRow(
  d: typeof drivers.$inferSelect,
  raw: string,
  overrides: Partial<typeof driverPredictionFeatures.$inferSelect> = {},
): SeasonFeatureRow {
  const f: typeof driverPredictionFeatures.$inferSelect = {
    id: 1, raceId: 1, driverId: d.id, features: storedGpFeatures(),
    rawWeightedScore: raw, winProbability: '0.20000', predictedPosition: 1,
    computedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
  return { driver_prediction_features: f, drivers: d, teams: team };
}

describe('aggregateSeasonScores', () => {
  test('averages the model score and win probability across a driver\'s rows', () => {
    const ver = driver(10, 'VER');
    const [agg] = aggregateSeasonScores([
      featureRow(ver, '1.0', { winProbability: '0.60000' }),
      featureRow(ver, '2.0', { winProbability: '0.20000' }),
    ]);
    expect(agg.avgRaw).toBe(1.5);
    expect(agg.rawWeightedScore).toBe('1.5');
    expect(Number(agg.winProbability)).toBeCloseTo(0.4);
  });

  test('groups rows by person so a mid-season team move collapses to one entry', () => {
    const verRedBull = driver(10, 'VER');
    const verOther = { ...driver(10, 'VER'), id: 99, teamId: 2 };
    const result = aggregateSeasonScores([featureRow(verRedBull, '1.0'), featureRow(verOther, '3.0')]);
    expect(result).toHaveLength(1);
    expect(result[0].avgRaw).toBe(2.0);
  });

  test('keeps two people who share a code apart (codes are labels, not keys)', () => {
    const bernard = { ...driver(1, 'BER'), firstName: 'Éric', lastName: 'Bernard' };
    const berger = { ...driver(2, 'BER'), firstName: 'Gerhard', lastName: 'Berger' };
    const result = aggregateSeasonScores([featureRow(bernard, '1.0'), featureRow(berger, '3.0')]);
    expect(result.map((r) => r.driver.lastName)).toEqual(['Bernard', 'Berger']);
  });
});

describe('buildIntelStandingRows', () => {
  test('ranks by avgRaw desc and min-max normalises to overallScore 0..100', () => {
    const rows = buildIntelStandingRows(
      [
        { driver: mapped(10, 'VER'), rawWeightedScore: '1', winProbability: '0.2', avgRaw: 1 },
        { driver: mapped(11, 'HAM'), rawWeightedScore: '3', winProbability: '0.5', avgRaw: 3 },
        { driver: mapped(12, 'NOR'), rawWeightedScore: '2', winProbability: '0.3', avgRaw: 2 },
      ],
      new Map(),
    );
    expect(rows.map((r) => r.driver.code)).toEqual(['HAM', 'NOR', 'VER']);
    expect(rows[0].overallScore).toBe(100);
    expect(rows[2].overallScore).toBe(0);
    expect(rows[1].overallScore).toBe(50);
  });

  test('folds in sprint season totals, defaulting to zeroes when absent', () => {
    const totals = new Map<number, SeasonTotals>([
      [10, { sprintWins: 2, sprintPodiums: 3, sprintTotalPoints: '17.0', totalPoints: '200.5' }],
    ]);
    const rows = buildIntelStandingRows(
      [
        { driver: mapped(10, 'VER'), rawWeightedScore: '2', winProbability: '0.4', avgRaw: 2 },
        { driver: mapped(11, 'HAM'), rawWeightedScore: '1', winProbability: '0.2', avgRaw: 1 },
      ],
      totals,
    );
    expect(rows[0]).toMatchObject({ sprintWins: 2, sprintPodiums: 3, sprintTotalPoints: '17.0', championshipPoints: '217.5' });
    expect(rows[1]).toMatchObject({ sprintWins: 0, sprintPodiums: 0, sprintTotalPoints: '0', championshipPoints: '0' });
  });

  test('single driver does not divide by zero', () => {
    const [row] = buildIntelStandingRows(
      [{ driver: mapped(10, 'VER'), rawWeightedScore: '2', winProbability: '0.4', avgRaw: 2 }],
      new Map(),
    );
    expect(row.overallScore).toBe(0);
  });
});
