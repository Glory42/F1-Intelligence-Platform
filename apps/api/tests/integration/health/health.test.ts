import { describe, expect, it } from 'bun:test';
import app from '../../../src/main';
import { testEnv } from '../../support/app/request';

const brokenDb = { ...testEnv, DATABASE_URL: 'postgres://f1:f1@localhost:4445/no_such_database' };

describe('health and crawler routes (integration)', () => {
  it('reports the API healthy without waking the database', async () => {
    const res = await app.request('/api/health', undefined, brokenDb);

    expect(res.status).toBe(200);
  });

  it('tells browsers not to sniff the content type', async () => {
    const res = await app.request('/api/health', undefined, brokenDb);

    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('reports a database outage on the explicit database check', async () => {
    const res = await app.request('/api/health/db', undefined, brokenDb);

    expect(res.status).toBe(503);
  });

  it.each(['/api/health/db', '/api/quality'])(
    'hides the dev-only %s in production, where each hit would wake Neon uncached',
    async (path) => {
      const res = await app.request(path, undefined, { ...brokenDb, ENVIRONMENT: 'production' });

      expect(res.status).toBe(404);
    },
  );

  it('keeps the data-quality report outside production', async () => {
    const res = await app.request('/api/quality?year=2099', undefined, testEnv);
    const { error } = (await res.json()) as { error: { message: string } };

    expect([res.status, error.message]).toEqual([404, 'No quality report for 2099']);
  });

  it('tells crawlers to stay off the API', async () => {
    const res = await app.request('/robots.txt', undefined, testEnv);

    expect(await res.text()).toBe('User-agent: *\nDisallow: /\n');
  });
});
