import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { apiRequest } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { races } from '../../../src/db/schema';
import { createSeason } from '../../support/factories/season.factory';
import { createCircuit } from '../../support/factories/circuit.factory';
import { createRace } from '../../support/factories/race.factory';
import { FakeEdgeCache } from '../../support/cache/fake-edge-cache';

type GlobalWithCaches = typeof globalThis & { caches?: { default: FakeEdgeCache } };

describe('edge cache (integration)', () => {
  const db = getTestDb();
  const edge = new FakeEdgeCache();
  let completedRaceId: number;

  beforeAll(async () => {
    await truncateAll(db);
    const season = await createSeason(db, { year: 2099 });
    const circuit = await createCircuit(db, { circuitKey: 'edge-cache-circuit' });
    const completed = await createRace(db, season.id, circuit.id, { name: 'Cached Grand Prix', status: 'completed' });
    completedRaceId = completed.id;
    seasonId = season.id;
    circuitId = circuit.id;
    (globalThis as GlobalWithCaches).caches = { default: edge };
  });

  let seasonId: number;
  let circuitId: number;

  afterEach(() => {
    edge.entries.clear();
  });

  afterAll(async () => {
    delete (globalThis as GlobalWithCaches).caches;
    await truncateAll(db);
  });

  it('serves a completed race from the edge cache instead of the database', async () => {
    await apiRequest(`/api/races/${completedRaceId}`);
    await db.update(races).set({ name: 'Renamed Grand Prix' }).where(eq(races.id, completedRaceId));

    const res = await apiRequest(`/api/races/${completedRaceId}`);
    const { data } = (await res.json()) as { data: { race: { name: string } } };

    expect(data.race.name).toBe('Cached Grand Prix');
  });

  it('never caches an error response', async () => {
    const missingId = completedRaceId + 1;
    const first = await apiRequest(`/api/races/${missingId}`);
    expect(first.status).toBe(404);
    await createRace(db, seasonId, circuitId, { roundNumber: 2, name: 'Late Grand Prix' });

    const res = await apiRequest(`/api/races/${missingId}`);

    expect(res.status).toBe(200);
  });

  it('never caches a response without a public Cache-Control', async () => {
    const first = (await (await apiRequest('/api/health')).json()) as { data: { timestamp: string } };
    await Bun.sleep(5);

    const second = (await (await apiRequest('/api/health')).json()) as { data: { timestamp: string } };

    expect(second.data.timestamp).not.toBe(first.data.timestamp);
  });

  it('answers a cache hit with the CORS origin of the current request', async () => {
    await apiRequest(`/api/races/${completedRaceId}`, { headers: { Origin: 'http://localhost:4321' } });

    const res = await apiRequest(`/api/races/${completedRaceId}`, { headers: { Origin: 'https://f1.gorkemkaryol.dev' } });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://f1.gorkemkaryol.dev');
  });

  it('never replays a previous origin to a request from a disallowed origin', async () => {
    await apiRequest(`/api/races/${completedRaceId}`, { headers: { Origin: 'https://f1.gorkemkaryol.dev' } });

    const res = await apiRequest(`/api/races/${completedRaceId}`, { headers: { Origin: 'https://evil.example' } });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('answers a request padded with params the route never reads from the same copy', async () => {
    const nameOf = async (res: Response) => ((await res.json()) as { data: { race: { name: string } } }).data.race.name;
    const cached = await nameOf(await apiRequest(`/api/races/${completedRaceId}`));
    await db.update(races).set({ name: 'Padded Grand Prix' }).where(eq(races.id, completedRaceId));

    const padded = await nameOf(await apiRequest(`/api/races/${completedRaceId}?utm_source=x&session=sprint`));

    expect(padded).toBe(cached);
  });

  it('keeps one copy per value of a param the route reads, whatever the param order', async () => {
    await apiRequest('/api/races?year=2099&status=completed');
    await apiRequest('/api/races?status=completed&year=2099&page=2');
    await apiRequest('/api/races?year=2098&status=completed');

    expect([...edge.entries.keys()].map((url) => new URL(url).search).sort()).toEqual([
      '?status=completed&year=2098&__v=1',
      '?status=completed&year=2099&__v=1',
    ]);
  });
});
