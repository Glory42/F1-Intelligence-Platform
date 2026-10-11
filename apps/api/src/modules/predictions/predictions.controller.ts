import type { Context } from 'hono';
import type { Bindings } from '../../common/types';
import { createDb } from '../../config/database';
import { PredictionsService } from './predictions.service';
import { FridayPaceService } from './friday-pace.service';
import { TitleOddsService } from './title-odds.service';
import { findRaceStatus } from '../../common/race-status';
import { CACHE_ACTIVE, cacheControlForStatus, cacheControlForYear, cacheIfData } from '../../common/cache';

const service = new PredictionsService();
const fridayPace = new FridayPaceService();
const titleOdds = new TitleOddsService();

export const PredictionsController = {
  getUpcoming: async (c: Context<{ Bindings: Bindings }>) => {
    const data = await service.findUpcoming(createDb(c.env.DATABASE_URL));
    if (!data) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'No upcoming prediction available' } }, 404);
    }
    c.header('Cache-Control', cacheControlForStatus(data.race.status));
    return c.json({ data, error: null });
  },

  getTitleOdds: async (c: Context<{ Bindings: Bindings }>) => {
    const year = Number(c.req.query('year') ?? new Date().getFullYear());
    const data = await titleOdds.findTitleOdds(createDb(c.env.DATABASE_URL), year);
    if (!data) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: `No title odds for ${year}` } }, 404);
    }
    c.header('Cache-Control', cacheControlForYear(year));
    return c.json({ data, error: null });
  },

  getFridayPace: async (c: Context<{ Bindings: Bindings }>) => {
    const raceId = Number(c.req.param('raceId'));
    if (isNaN(raceId)) {
      return c.json({ data: null, error: { code: 'INVALID_ID', message: 'raceId must be a number' } }, 400);
    }
    const db = createDb(c.env.DATABASE_URL);
    const status = await findRaceStatus(db, raceId);
    if (!status) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: `Race ${raceId} not found` } }, 404);
    }
    const data = await fridayPace.findFridayPace(db, raceId);
    c.header('Cache-Control', cacheIfData(cacheControlForStatus(status), data.length > 0));
    return c.json({ data, error: null });
  },

  getByRaceId: async (c: Context<{ Bindings: Bindings }>) => {
    const raceId = Number(c.req.param('raceId'));
    if (isNaN(raceId)) {
      return c.json({ data: null, error: { code: 'INVALID_ID', message: 'raceId must be a number' } }, 400);
    }
    const data = await service.findByRaceId(createDb(c.env.DATABASE_URL), raceId);
    if (!data) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: `No prediction for race ${raceId}` } }, 404);
    }
    c.header('Cache-Control', cacheControlForStatus(data.race.status));
    return c.json({ data, error: null });
  },

  getHistory: async (c: Context<{ Bindings: Bindings }>) => {
    const year = Number(c.req.query('year') ?? new Date().getFullYear());
    const data = await service.findHistory(createDb(c.env.DATABASE_URL), year);
    // Only a fully past season is guaranteed to have every race completed.
    c.header('Cache-Control', cacheControlForYear(year));
    return c.json({ data, error: null });
  },

  getAccuracy: async (c: Context<{ Bindings: Bindings }>) => {
    const data = await service.findAccuracyBySeason(createDb(c.env.DATABASE_URL));
    // Response spans every season, and the most recent one is almost always still in
    // progress — cache short rather than trying to reason about which years are final.
    c.header('Cache-Control', CACHE_ACTIVE);
    return c.json({ data, error: null });
  },

  getIntelStandings: async (c: Context<{ Bindings: Bindings }>) => {
    const year = Number(c.req.query('year') ?? new Date().getFullYear());
    const data = await service.findIntelStandings(createDb(c.env.DATABASE_URL), year);
    c.header('Cache-Control', cacheControlForYear(year));
    return c.json({ data, error: null });
  },

  getModelInfo: async (c: Context<{ Bindings: Bindings }>) => {
    const data = await service.getModelInfo(createDb(c.env.DATABASE_URL));
    return c.json({ data, error: null });
  },
};
