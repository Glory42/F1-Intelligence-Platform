import type { Context } from 'hono';
import type { Bindings } from '../../common/types';
import { INVALID_SESSION_ERROR, parseRaceSession } from '../../common/session';
import { createDb } from '../../config/database';
import { cacheControlForStatus, cacheIfData } from '../../common/cache';
import { StrategyService } from './strategy.service';
import { findRaceStatus } from '../../common/race-status';

const service = new StrategyService();

export const StrategyController = {
  async getStrategy(c: Context<{ Bindings: Bindings }>) {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ data: null, error: { code: 'INVALID_ID', message: 'id must be a number' } }, 400);
    }
    const session = parseRaceSession(c.req.query('session'));
    if (!session) return c.json({ data: null, error: INVALID_SESSION_ERROR }, 400);
    const db = createDb(c.env.DATABASE_URL);
    const status = await findRaceStatus(db, id);
    if (!status) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: `Race ${id} not found` } }, 404);
    }
    const data = await service.findStrategy(db, id, session);
    c.header('Cache-Control', cacheIfData(cacheControlForStatus(status), data.source !== 'none'));
    return c.json({ data, error: null });
  },
};
