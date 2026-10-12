import type { Context } from 'hono';
import type { Bindings } from '../../common/types';
import { createDb } from '../../config/database';
import { PredictionsService } from './predictions.service';
import { FridayPaceService } from './friday-pace.service';
import { TitleOddsService } from './title-odds.service';
import { raceRoute, seasonRoute } from '../../common/route';
import { CACHE_ACTIVE, CACHE_REFERENCE, cacheControlForStatus } from '../../common/cache';

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

  getTitleOdds: seasonRoute({
    load: ({ db, year }) => titleOdds.findTitleOdds(db, year),
    missing: (year) => `No title odds for ${year}`,
  }),

  getFridayPace: raceRoute({
    param: 'raceId',
    load: ({ db, race }) => fridayPace.findFridayPace(db, race.id),
  }),

  getByRaceId: raceRoute({
    param: 'raceId',
    load: ({ db, race }) => service.findByRaceId(db, race.id),
    missing: (raceId) => `No prediction for race ${raceId}`,
  }),

  getHistory: seasonRoute({
    load: ({ db, year }) => service.findHistory(db, year),
  }),

  getAccuracy: async (c: Context<{ Bindings: Bindings }>) => {
    const data = await service.findAccuracyBySeason(createDb(c.env.DATABASE_URL));
    // Response spans every season, and the most recent one is almost always still in
    // progress: cache short rather than trying to reason about which years are final.
    c.header('Cache-Control', CACHE_ACTIVE);
    return c.json({ data, error: null });
  },

  getIntelStandings: seasonRoute({
    load: ({ db, year }) => service.findIntelStandings(db, year),
  }),

  getModelInfo: async (c: Context<{ Bindings: Bindings }>) => {
    const data = await service.getModelInfo(createDb(c.env.DATABASE_URL));
    c.header('Cache-Control', CACHE_REFERENCE);
    return c.json({ data, error: null });
  },
};
