import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import app from '../../../src/main';
import { testEnv } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { FakeKv } from '../../support/kv/fake-kv';
import { races } from '../../../src/db/schema';
import { createSeason } from '../../support/factories/season.factory';
import { createCircuit } from '../../support/factories/circuit.factory';
import { createRace } from '../../support/factories/race.factory';

type RaceBody = { data: { race: { name: string } } };

describe('KV cache (integration)', () => {
  const db = getTestDb();
  let kv: FakeKv;
  let upcomingRaceId: number;
  let completedRaceId: number;

  const request = (path: string) => app.request(path, undefined, { ...testEnv, API_CACHE: kv });
  const brokenDbRequest = (path: string) => app.request(path, undefined, {
    ...testEnv, DATABASE_URL: 'postgres://f1:f1@localhost:4445/no_such_database', API_CACHE: kv,
  });
  const raceName = async (res: Response) => ((await res.json()) as RaceBody).data.race.name;
  const rename = (id: number, name: string) => db.update(races).set({ name }).where(eq(races.id, id));

  beforeAll(async () => {
    await truncateAll(db);
    const season = await createSeason(db, { year: new Date().getFullYear() });
    const circuit = await createCircuit(db, { circuitKey: 'kv-cache-circuit' });
    const upcoming = await createRace(db, season.id, circuit.id, { name: 'Upcoming Grand Prix', status: 'scheduled' });
    upcomingRaceId = upcoming.id;
    const completed = await createRace(db, season.id, circuit.id, {
      roundNumber: 2, name: 'Finished Grand Prix', status: 'completed',
    });
    completedRaceId = completed.id;
  });

  beforeEach(async () => {
    kv = new FakeKv();
    kv.setState({ version: 'v1' });
    await rename(upcomingRaceId, 'Upcoming Grand Prix');
    await rename(completedRaceId, 'Finished Grand Prix');
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it('answers a repeat request from KV while the data version is unchanged', async () => {
    await request(`/api/races/${upcomingRaceId}`);
    await rename(upcomingRaceId, 'Renamed Grand Prix');

    const res = await request(`/api/races/${upcomingRaceId}`);

    expect(await raceName(res)).toBe('Upcoming Grand Prix');
  });

  it('answers from the database again once the data engine bumps the version', async () => {
    await request(`/api/races/${upcomingRaceId}`);
    await rename(upcomingRaceId, 'Renamed Grand Prix');
    kv.setState({ version: 'v2' });

    const res = await request(`/api/races/${upcomingRaceId}`);

    expect(await raceName(res)).toBe('Renamed Grand Prix');
  });

  it('keeps a completed race cached across version bumps, since it can no longer change', async () => {
    await request(`/api/races/${completedRaceId}`);
    await rename(completedRaceId, 'Renamed Grand Prix');
    kv.setState({ version: 'v2' });

    const res = await request(`/api/races/${completedRaceId}`);

    expect(await raceName(res)).toBe('Finished Grand Prix');
  });

  it('serves the last good answer when the database fails, even from an older version', async () => {
    await request(`/api/races/${upcomingRaceId}`);
    kv.setState({ version: 'v2' });

    const res = await brokenDbRequest(`/api/races/${upcomingRaceId}`);

    expect(res.status).toBe(200);
    expect(await raceName(res)).toBe('Upcoming Grand Prix');
  });

  it('keeps answering from an older version while the budget watchdog asks to serve stale', async () => {
    await request(`/api/races/${upcomingRaceId}`);
    await rename(upcomingRaceId, 'Renamed Grand Prix');
    kv.setState({ version: 'v2', serveStale: true });

    const res = await request(`/api/races/${upcomingRaceId}`);

    expect(await raceName(res)).toBe('Upcoming Grand Prix');
  });

  it('still answers when KV refuses the write (free-tier daily write limit)', async () => {
    kv.failWrites = true;

    const res = await request(`/api/races/${upcomingRaceId}`);

    expect(await raceName(res)).toBe('Upcoming Grand Prix');
  });

  it('falls through to the database when KV refuses the read (free-tier daily read limit)', async () => {
    kv.failReads = true;

    const res = await request(`/api/races/${upcomingRaceId}`);

    expect(await raceName(res)).toBe('Upcoming Grand Prix');
  });

  it('answers a KV hit with the CORS origin of the current request', async () => {
    const env = { ...testEnv, API_CACHE: kv };
    await app.request(`/api/races/${upcomingRaceId}`, { headers: { Origin: 'http://localhost:4321' } }, env);

    const res = await app.request(
      `/api/races/${upcomingRaceId}`, { headers: { Origin: 'https://f1.gorkemkaryol.dev' } }, env,
    );

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://f1.gorkemkaryol.dev');
  });

  it('never caches under wrangler dev, where nothing bumps the local KV', async () => {
    const devEnv = { ...testEnv, ENVIRONMENT: 'development', API_CACHE: kv };
    await app.request(`/api/races/${upcomingRaceId}`, undefined, devEnv);
    await rename(upcomingRaceId, 'Renamed Grand Prix');

    const res = await app.request(`/api/races/${upcomingRaceId}`, undefined, devEnv);

    expect(await raceName(res)).toBe('Renamed Grand Prix');
  });
});
