import { describe, expect, test } from 'vitest';
import { driver, driverB, circuit } from '../../support/msw/fixtures';
import { predictionShareCard, raceShareCard, shareImageKey, shareImageUrl } from '@/lib/shareImage';
import type { PredictionResponse, Race, RaceDetailResponse, RaceResult } from '@/types';

const race = { id: 7, roundNumber: 16, name: 'Italian Grand Prix', raceDate: '2025-09-07', status: 'completed', circuit } as Race;
const result = (d: typeof driver, finishPosition: number | null) => ({ driver: d, finishPosition }) as RaceResult;
const third = { ...driverB, id: 12, fullName: 'Lando Norris', team: { ...driverB.team, teamKey: 'mclaren', name: 'McLaren' } };

describe('share image addresses', () => {
  test('one key per race and kind, under the configured public URL', () => {
    expect(shareImageKey('race', 7)).toBe('og/race/7.png');
    expect(shareImageUrl('https://og.example/', 'prediction', 7)).toBe('https://og.example/og/prediction/7.png');
  });

  test('no URL until the bucket is configured, so pages keep the default image', () => {
    expect(shareImageUrl(undefined, 'race', 7)).toBeUndefined();
    expect(shareImageUrl('', 'race', 7)).toBeUndefined();
  });
});

describe('raceShareCard', () => {
  const detail = (overrides: Partial<RaceDetailResponse> = {}): RaceDetailResponse => ({
    race, qualifying: [], laps: [],
    results: [result(driverB, 2), result(third, 3), result(driver, 1), result(driver, null)],
    ...overrides,
  });

  test('shows the podium in finishing order with team colours', () => {
    const card = raceShareCard(detail());

    expect(card?.kicker).toBe('Round 16 · 2025 · Result');
    expect(card?.subtitle).toBe('Autodromo Nazionale Monza · Italy');
    expect(card?.rows.map((r) => [r.place, r.name, r.detail])).toEqual([
      ['P1', 'Max Verstappen', 'Red Bull Racing'], ['P2', 'Charles Leclerc', 'Ferrari'], ['P3', 'Lando Norris', 'McLaren'],
    ]);
  });

  test('has nothing to show before the race is completed', () => {
    expect(raceShareCard(detail({ race: { ...race, status: 'qualifying_done' } }))).toBeNull();
    expect(raceShareCard(detail({ results: [] }))).toBeNull();
  });
});

describe('predictionShareCard', () => {
  const row = (d: typeof driver, winProbability: string) => ({ driver: d, winProbability }) as PredictionResponse['drivers'][number];

  test("lists the model's three favourites by win chance", () => {
    const card = predictionShareCard({
      race, modelVersion: 'weighted-v4',
      drivers: [row(third, '0.081'), row(driver, '0.62'), row(driverB, '0.25'), row({ ...driver, id: 99 }, '0.01')],
    } as PredictionResponse);

    expect(card?.subtitle).toBe('Win chances · model weighted-v4');
    expect(card?.rows.map((r) => [r.place, r.name, r.detail])).toEqual([
      ['P1', 'Max Verstappen', '62%'], ['P2', 'Charles Leclerc', '25%'], ['P3', 'Lando Norris', '8%'],
    ]);
  });
});
