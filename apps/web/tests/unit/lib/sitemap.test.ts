import { describe, expect, test } from 'vitest';
import { server } from '../../support/msw/server';
import { apiError, apiOk, recordApiRequests } from '../../support/msw/routes';
import { circuit, driver, driverB, team, teamB } from '../../support/msw/fixtures';
import { loadSitemapSources, renderUrlset, sitemapPaths } from '@/lib/sitemap';
import type { PredictionHistoryItem, Race } from '@/types';

const race = (id: number) => ({ id, circuit }) as Race;
const prediction = (raceId: number) => ({ raceId }) as PredictionHistoryItem;
const SITE = new URL('https://f1.example');

describe('loadSitemapSources', () => {
  test("reads one season's lists and every circuit", async () => {
    const seen = recordApiRequests();
    server.use(
      apiOk('/api/races', [race(1), race(2)]),
      apiOk('/api/drivers', [driver, driverB]),
      apiOk('/api/teams', [team, teamB]),
      apiOk('/api/races/circuits', [circuit]),
      apiOk('/api/predictions/history', [prediction(1)]),
    );

    const sources = await loadSitemapSources(2026);

    expect(seen.sort()).toEqual([
      '/api/drivers?year=2026', '/api/predictions/history?year=2026', '/api/races/circuits',
      '/api/races?year=2026', '/api/teams?year=2026',
    ]);
    expect(sources.races.map((r) => r.id)).toEqual([1, 2]);
  });

  test('still lists the rest when one list fails', async () => {
    server.use(
      apiError('/api/races'),
      apiOk('/api/drivers', [driver]),
      apiOk('/api/teams', []),
      apiOk('/api/races/circuits', []),
      apiError('/api/predictions/history'),
    );

    const sources = await loadSitemapSources(2026);

    expect(sources.races).toEqual([]);
    expect(sources.drivers).toEqual([driver]);
  });
});

describe('sitemapPaths', () => {
  test('lists each detail page once', () => {
    const paths = sitemapPaths({
      races: [race(1), race(2)], predictions: [prediction(1)], drivers: [driver, driverB],
      teams: [team, teamB], circuits: [circuit, circuit],
    });

    expect(paths).toEqual([
      '/races/1', '/races/2', '/prediction/1', '/drivers/10', '/drivers/11', '/teams/1', '/teams/2', '/circuits/monza',
    ]);
  });
});

describe('renderUrlset', () => {
  test('writes absolute, escaped locations', () => {
    const xml = renderUrlset(SITE, ['/races/1', "/circuits/a&b'"]);

    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain('<url><loc>https://f1.example/races/1</loc></url>');
    expect(xml).toContain('<loc>https://f1.example/circuits/a&amp;b&apos;</loc>');
  });
});
