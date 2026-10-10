import type { Context } from 'hono';
import type { Bindings } from '../../common/types';
import { createDb } from '../../config/database';
import { HistoryService } from './history.service';
import { cacheIfData } from '../../common/cache';

const service = new HistoryService();
// F1DB updates after each race; a day-long cache is plenty for all-time history.
const CACHE_HISTORY = 'public, max-age=86400';

function parseId(c: Context<{ Bindings: Bindings }>): number | null {
  const id = Number(c.req.param('id'));
  return isNaN(id) ? null : id;
}

export const HistoryController = {
  async getOnThisDay(c: Context<{ Bindings: Bindings }>) {
    const monthDay = c.req.query('date') ?? '';
    if (!/^\d{2}-\d{2}$/.test(monthDay)) {
      return c.json({ data: null, error: { code: 'INVALID_DATE', message: 'date must be MM-DD' } }, 400);
    }
    const data = await service.findOnThisDay(createDb(c.env.DATABASE_URL), monthDay);
    c.header('Cache-Control', cacheIfData(CACHE_HISTORY, data.length > 0));
    return c.json({ data, error: null });
  },

  async getRecords(c: Context<{ Bindings: Bindings }>) {
    const data = await service.findRecords(createDb(c.env.DATABASE_URL));
    c.header('Cache-Control', cacheIfData(CACHE_HISTORY, data.drivers.wins.length > 0));
    return c.json({ data, error: null });
  },

  async getDriverHistory(c: Context<{ Bindings: Bindings }>) {
    const id = parseId(c);
    if (id == null) return c.json({ data: null, error: { code: 'INVALID_ID', message: 'id must be a number' } }, 400);
    const data = await service.findDriverHistory(createDb(c.env.DATABASE_URL), id);
    if (!data) return c.json({ data: null, error: { code: 'NOT_FOUND', message: `No history for driver ${id}` } }, 404);
    c.header('Cache-Control', CACHE_HISTORY);
    return c.json({ data, error: null });
  },

  async getTeamHistory(c: Context<{ Bindings: Bindings }>) {
    const id = parseId(c);
    if (id == null) return c.json({ data: null, error: { code: 'INVALID_ID', message: 'id must be a number' } }, 400);
    const data = await service.findTeamHistory(createDb(c.env.DATABASE_URL), id);
    if (!data) return c.json({ data: null, error: { code: 'NOT_FOUND', message: `No history for team ${id}` } }, 404);
    c.header('Cache-Control', CACHE_HISTORY);
    return c.json({ data, error: null });
  },
};
