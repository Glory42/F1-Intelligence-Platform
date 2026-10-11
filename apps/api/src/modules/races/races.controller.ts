import type { Context } from 'hono';
import type { Bindings } from '../../common/types';
import { createDb } from '../../config/database';
import { RacesService } from './races.service';
import { cacheControlForStatus } from '../../common/cache';

const service = new RacesService();

export const RacesController = {
  getAll: async (c: Context<{ Bindings: Bindings }>) => {
    const year = Number(c.req.query('year') ?? new Date().getFullYear());
    const status = c.req.query('status');
    if (isNaN(year)) {
      return c.json({ data: null, error: { code: 'INVALID_YEAR', message: 'year must be a number' } }, 400);
    }
    const data = await service.findAll(createDb(c.env.DATABASE_URL), year, status);
    // Only a status=completed filter guarantees every row in the list is immutable —
    // an unfiltered or non-completed filter can include a race that's still in progress.
    c.header('Cache-Control', cacheControlForStatus(status ?? ''));
    return c.json({ data, error: null });
  },

  getById: async (c: Context<{ Bindings: Bindings }>) => {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ data: null, error: { code: 'INVALID_ID', message: 'id must be a number' } }, 400);
    }
    const data = await service.findById(createDb(c.env.DATABASE_URL), id);
    if (!data) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: `Race ${id} not found` } }, 404);
    }
    c.header('Cache-Control', cacheControlForStatus(data.race.status));
    return c.json({ data, error: null });
  },
};
