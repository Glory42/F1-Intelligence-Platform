import { api } from '@/lib/api';
import { unwrapSettled } from '@/lib/utils';
import type { Circuit, Driver, PredictionHistoryItem, Race, Team } from '@/types';

export type SitemapSources = {
  races: Race[];
  drivers: Driver[];
  teams: Team[];
  circuits: Circuit[];
  predictions: PredictionHistoryItem[];
};

// The build-time sitemap only knows static routes; detail pages are listed here instead.
// One season keeps the request to five cached API reads, well inside Workers Free.
export async function loadSitemapSources(year: number): Promise<SitemapSources> {
  const [races, drivers, teams, circuits, predictions] = await Promise.allSettled([
    api.getRaces(year), api.getDrivers(year), api.getTeams(year), api.getCircuits(), api.getPredictionHistory(year),
  ]);
  return {
    races: unwrapSettled(races, []),
    drivers: unwrapSettled(drivers, []),
    teams: unwrapSettled(teams, []),
    circuits: unwrapSettled(circuits, []),
    predictions: unwrapSettled(predictions, []),
  };
}

export function sitemapPaths({ races, drivers, teams, circuits, predictions }: SitemapSources): string[] {
  const paths = [
    ...races.map((race) => `/races/${race.id}`),
    ...predictions.map((item) => `/prediction/${item.raceId}`),
    ...drivers.map((driver) => `/drivers/${driver.id}`),
    ...teams.map((team) => `/teams/${team.id}`),
    ...circuits.map((circuit) => `/circuits/${encodeURIComponent(circuit.circuitKey)}`),
  ];
  return [...new Set(paths)];
}

const XML_ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => XML_ENTITIES[char]);
}

export function renderUrlset(site: URL, paths: string[]): string {
  const urls = paths.map((path) => `<url><loc>${escapeXml(new URL(path, site).href)}</loc></url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
  ].join('\n');
}
