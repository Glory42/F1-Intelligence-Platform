import { describe, expect, it } from 'bun:test';
import app from '../../../src/main';
import { testEnv } from '../../support/app/request';

const brokenDb = { ...testEnv, DATABASE_URL: 'postgres://f1:f1@localhost:4445/no_such_database' };

describe('health and crawler routes (integration)', () => {
  it('reports the API healthy without waking the database', async () => {
    const res = await app.request('/api/health', undefined, brokenDb);

    expect(res.status).toBe(200);
  });

  it('reports a database outage on the explicit database check', async () => {
    const res = await app.request('/api/health/db', undefined, brokenDb);

    expect(res.status).toBe(503);
  });

  it('tells crawlers to stay off the API', async () => {
    const res = await app.request('/robots.txt', undefined, testEnv);

    expect(await res.text()).toBe('User-agent: *\nDisallow: /\n');
  });
});
