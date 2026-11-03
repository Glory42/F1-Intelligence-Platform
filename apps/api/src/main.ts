import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { sql } from 'drizzle-orm';
import { createDb } from './config/database';
import { configureLocalNeonProxy } from './config/localNeonProxy';
import circuitsModule from './modules/circuits/circuits.module';
import racesModule from './modules/races/races.module';
import raceEventsModule from './modules/race-events/race-events.module';
import strategyModule from './modules/strategy/strategy.module';
import raceStoryModule from './modules/race-story/race-story.module';
import telemetryModule from './modules/telemetry/telemetry.module';
import historyModule from './modules/history/history.module';
import driversModule from './modules/drivers/drivers.module';
import teamsModule from './modules/teams/teams.module';
import predictionsModule from './modules/predictions/predictions.module';
import seasonsModule from './modules/seasons/seasons';
import sprintModule from './modules/sprint/sprint.module';
import searchModule from './modules/search/search';
import qualityModule from './modules/quality/quality';
import type { Bindings } from './common/types';
import { edgeCache } from './common/edge-cache';
import { kvCache } from './common/kv-cache';

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', logger());
app.use('*', async (c, next) => {
  if (c.env) {
    if (typeof process !== 'undefined' && process.env) {
      for (const [key, value] of Object.entries(c.env)) {
        if (typeof value === 'string') {
          process.env[key] = value;
        }
      }
    }
    configureLocalNeonProxy(c.env.NEON_FETCH_ENDPOINT);
  }
  await next();
});
const PROD_ORIGINS = ['https://f1.gorkemkaryol.dev'];
const DEV_ORIGINS = ['http://localhost:4321', 'http://localhost:8787'];

app.use('*', cors({
  origin: (origin, c) => {
    const allowed = c.env.ENVIRONMENT === 'production' ? PROD_ORIGINS : [...PROD_ORIGINS, ...DEV_ORIGINS];
    return allowed.includes(origin) ? origin : null;
  },
  allowMethods: ['GET', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}));
app.use('/api/*', edgeCache());
app.use('/api/*', kvCache());

app.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /\n'));

// Uptime checks hit this one: it must not wake Neon (each wake bills at least 5 min of compute).
app.get('/api/health', (c) => c.json({ data: { status: 'ok', timestamp: new Date().toISOString() }, error: null }));

app.get('/api/health/db', async (c) => {
  try {
    await createDb(c.env.DATABASE_URL).execute(sql`SELECT 1`);
    return c.json({ data: { status: 'ok', db: 'connected', timestamp: new Date().toISOString() }, error: null });
  } catch {
    return c.json({ data: null, error: { code: 'DB_ERROR', message: 'Database unreachable' } }, 503);
  }
});

app.route('/api/races', circuitsModule);
app.route('/api/races', racesModule);
app.route('/api/races', raceEventsModule);
app.route('/api/races', strategyModule);
app.route('/api/races', raceStoryModule);
app.route('/api/races', telemetryModule);
app.route('/api/drivers', driversModule);
app.route('/api/teams', teamsModule);
app.route('/api/predictions', predictionsModule);
app.route('/api/sprint', sprintModule);
app.route('/api/seasons', seasonsModule);
app.route('/api/history', historyModule);
app.route('/api/search', searchModule);
app.route('/api/quality', qualityModule);

app.onError((err, c) => {
  console.error(err.message);
  return c.json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
});

app.notFound((c) => {
  return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404);
});

export default app;
