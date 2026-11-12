import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import app from '../../../src/main';
import type { Bindings } from '../../../src/common/types';
import { races } from '../../../src/db/schema';
import { testEnv } from '../../support/app/request';
import { getTestDb, truncateAll } from '../../support/db/test-db';
import { FakeSnapshotBucket } from '../../support/cache/fake-snapshot-bucket';
import { createSeason } from '../../support/factories/season.factory';
import { createCircuit } from '../../support/factories/circuit.factory';
import { createRace } from '../../support/factories/race.factory';

type RaceBody = { data: { race: { name: string } } | null };

describe('snapshot store (integration)', () => {
  const db = getTestDb();
  const bucket = new FakeSnapshotBucket();
  const env: Bindings = { ...testEnv, SNAPSHOTS: bucket };
  const neonDown: Bindings = { ...env, DATABASE_URL: 'postgres://f1:f1@localhost:4445/no_such_database' };
  const request = (path: string, init?: RequestInit, bindings: Bindings = env) => app.request(path, init, bindings);
  let raceId: number;

  beforeAll(async () => {
    await truncateAll(db);
    const season = await createSeason(db, { year: 2099 });
    const circuit = await createCircuit(db, { circuitKey: 'snapshot-circuit' });
    raceId = (await createRace(db, season.id, circuit.id, { name: 'Stored Grand Prix', status: 'completed' })).id;
  });

  afterEach(async () => {
    bucket.objects.clear();
    await db.update(races).set({ name: 'Stored Grand Prix' }).where(eq(races.id, raceId));
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  it('answers a completed race from the store without reading the database', async () => {
    await request(`/api/races/${raceId}`);
    await db.update(races).set({ name: 'Renamed Grand Prix' }).where(eq(races.id, raceId));

    const res = await request(`/api/races/${raceId}`);
    const { data } = (await res.json()) as RaceBody;

    expect(data?.race.name).toBe('Stored Grand Prix');
    expect(res.headers.get('x-snapshot')).toBe('hit');
  });

  it('keeps answering from a lapsed copy while Neon is down', async () => {
    await request(`/api/races/${raceId}`);
    for (const stored of bucket.objects.values()) stored.customMetadata.freshUntil = '0';

    const res = await request(`/api/races/${raceId}`, undefined, neonDown);
    const { data } = (await res.json()) as RaceBody;

    expect(res.status).toBe(200);
    expect(data?.race.name).toBe('Stored Grand Prix');
    expect(res.headers.get('x-snapshot')).toBe('stale');
  });

  it('never stores an error response', async () => {
    await request(`/api/races/${raceId + 1000}`);

    expect(bucket.objects.size).toBe(0);
  });

  it('answers a hit with the CORS origin of the current request', async () => {
    await request(`/api/races/${raceId}`, { headers: { Origin: 'http://localhost:4321' } });

    const res = await request(`/api/races/${raceId}`, { headers: { Origin: 'https://f1.gorkemkaryol.dev' } });

    expect(res.headers.get('x-snapshot')).toBe('hit');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://f1.gorkemkaryol.dev');
  });
});
