import type { Context } from 'hono';
import type { Bindings } from '../../common/types';
import { createDb } from '../../config/database';
import { cacheControlForStatus, cacheIfData } from '../../common/cache';
import { findRaceStatus } from '../../common/race-status';
import { INVALID_SESSION_ERROR, parseRaceSession } from '../../common/session';
import { RaceStoryService } from './race-story.service';
import { RecapService } from './recap.service';

const service = new RaceStoryService();
const recaps = new RecapService();

export const RaceStoryController = {
  async getRecap(c: Context<{ Bindings: Bindings }>) {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ data: null, error: { code: 'INVALID_ID', message: 'id must be a number' } }, 400);
    }
    const db = createDb(c.env.DATABASE_URL);
    const status = await findRaceStatus(db, id);
    if (!status) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: `Race ${id} not found` } }, 404);
    }
    const data = await recaps.findRecap(db, id);
    c.header('Cache-Control', cacheIfData(cacheControlForStatus(status), data.winner != null));
    return c.json({ data, error: null });
  },

  async getRaceStory(c: Context<{ Bindings: Bindings }>) {
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
    const data = await service.findRaceStory(db, id, session);
    c.header('Cache-Control', cacheIfData(cacheControlForStatus(status), data.drivers.length > 0));
    return c.json({ data, error: null });
  },
};
